"""DWD annual precipitation grids -> H3 -> binary sculpture buffers.

    per year: 1 km ASCII grid (already clipped to Germany)
     -> cell centres reprojected EPSG:31467 -> WGS84
     -> H3 cell of the centre
     -> mean per cell (a depth in mm: two 1 km pixels of 800 mm do not
        make 1600 mm)
     -> aggregate to the coarser resolution
    all years share one cell universe (the grid footprint)
     -> stats + binary (rain_mm_{year}.f32) + dataset.json

The country LOD is r7 (~5 km2 cells): the app loads every metric of a
dataset up front, and at 1.4 MB per year r8 would be tens of megabytes.
r8 is written as a tiled LOD and streamed on zoom instead - its 0.74 km2
cells are as fine as the 1 km source can honestly carry.

Source: Deutscher Wetterdienst, Climate Data Center. Open data, no login;
"Datenlizenz Deutschland - Namensnennung - Version 2.0".

The binary writer and the tiled writer are shared with the census pipeline
(pip install -e pipelines/zensus).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import subprocess
import sys
from pathlib import Path

from zensus_pipeline.aggregate import accumulate_mean, aggregate_mean_to_parent
from zensus_pipeline.provenance import provenance
from zensus_pipeline.binary_writer import (
    bounds_of,
    compute_stats,
    merge_dataset_manifest,
    write_f32,
    write_positions,
)
from zensus_pipeline.tiling import H3_EDGE_METERS, TILE_PARENT_RES, write_tiled_lod
from zensus_pipeline.years import parse_years

from .grids import CDC, download, local_path, sample_grid

# DWD publishes its open geodata under CC BY 4.0, not the Datenlizenz
# Deutschland: opendata.dwd.de/climate_environment/CDC/Terms_of_use.txt and
# dwd.de/DE/service/rechtliche_hinweise. Checked 21 August 2026.
LICENSE = "CC BY 4.0"


def positions_for(cells: list[str]) -> list[tuple[float, float]]:
    import h3

    out = []
    for cell in cells:
        lat, lon = h3.cell_to_latlng(cell)
        out.append((round(lon, 6), round(lat, 6)))
    return out


def run(args: argparse.Namespace) -> None:
    import h3

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cache = Path(args.cache)
    years = parse_years(args.years)
    resolutions = sorted({int(r) for r in args.resolutions.split(",")}, reverse=True)
    base_res = resolutions[0]
    country_res = min(resolutions)
    tiled = {int(r) for r in args.tiled.split(",") if r.strip()} if args.tiled else set()

    per_year: dict[int, tuple[dict, dict]] = {}
    for year in years:
        path = (
            local_path(cache, args.variable, year, args.period)
            if args.no_fetch
            else download(args.variable, year, cache, args.period)
        )
        if not path.exists():
            raise SystemExit(f"{path} missing (and --no-fetch given)")
        print(f"Year {year}: {path.name} to H3 r{base_res} ...", file=sys.stderr)
        samples = (
            (h3.latlng_to_cell(lat, lon, base_res), value)
            for lon, lat, value in sample_grid(path, args.scale)
        )
        means, counts = accumulate_mean(samples)
        if not means:
            raise SystemExit(f"{year}: the grid carries no data")
        print(f"  {len(means):,} r{base_res} cells", file=sys.stderr)
        per_year[year] = (means, counts)

    metric_entries: list[dict] = []
    lod_fragments: list[dict] = []

    for res in resolutions:
        values_by_year: dict[int, dict] = {}
        for year, (means, counts) in per_year.items():
            if res == base_res:
                values_by_year[year] = dict(means)
            else:
                values_by_year[year], _ = aggregate_mean_to_parent(
                    means, counts, lambda c, r=res: h3.cell_to_parent(c, r)
                )
        res_dir = out / f"r{res}"
        res_dir.mkdir(parents=True, exist_ok=True)
        # runs into the same output must share a cell universe, or the
        # year buffers kept by merge_dataset_manifest no longer line up
        # with positions.bin. The first run defines it.
        cells_file = res_dir / "cells.txt"
        if cells_file.exists():
            universe = cells_file.read_text(encoding="utf-8").split()
            new_cells = set().union(*(v.keys() for v in values_by_year.values()))
            dropped = len(new_cells - set(universe))
            if dropped:
                print(f"  r{res}: {dropped:,} cells outside the existing "
                      "universe dropped (delete the output directory and "
                      "re-run all years to grow it)", file=sys.stderr)
        else:
            universe = sorted(set().union(*(v.keys() for v in values_by_year.values())))
            cells_file.write_text("\n".join(universe), encoding="utf-8")
        positions = positions_for(universe)
        write_positions(res_dir / "positions.bin", positions)

        stats_by_metric: dict[str, dict] = {}
        metric_files: list[tuple[str, list, str]] = []
        for year in years:
            metric_id = f"{args.metric_prefix}_{year}"
            # a cell without a reading that year is missing, not 0 mm
            aligned = [values_by_year[year].get(cell) for cell in universe]
            write_f32(res_dir / f"{metric_id}.f32", aligned)
            stats = compute_stats(aligned)
            stats_by_metric[metric_id] = stats
            metric_files.append((f"{metric_id}.f32", aligned, "f32"))
            if res == country_res:
                metric_entries.append({
                    "id": metric_id,
                    "label": f"{args.label} {year}",
                    "unit": args.unit,
                    "storage": "f32",
                    "aggregation": "weightedMean",
                    "stats": stats,
                })

        fragment = {
            "resolution": res,
            "count": len(universe),
            "bounds": bounds_of(positions),
            "cellRadiusMeters": H3_EDGE_METERS.get(res, 1220.6),
            "minZoom": 0 if res == country_res else 7.0,
            "positions": f"r{res}/positions.bin",
            "metricTemplate": f"r{res}/{{metric}}",
            "metricStats": stats_by_metric,
        }
        if res in tiled:
            tile_fragment, tile_count = write_tiled_lod(
                res_dir, res, universe, positions, metric_files, stats_by_metric,
                lambda c: h3.cell_to_parent(c, TILE_PARENT_RES),
            )
            fragment.update(tile_fragment)
            print(f"  r{res}: {tile_count:,} tiles", file=sys.stderr)
        lod_fragments.append(fragment)
        print(f"  r{res}: {len(universe):,} cells, {len(years)} year(s)", file=sys.stderr)

    dataset = {
        "id": args.dataset_id,
        "title": args.dataset_title,
        "spatialResolution": 1000,
        "metrics": metric_entries,
        "lods": lod_fragments,
        "source": {
            "label": "Data: Deutscher Wetterdienst",
            "url": f"{CDC}/annual/{args.variable}/",
            "license": LICENSE,
            "referenceDate": args.reference_date or f"{years[-1]}-12-31",
            "provenance": provenance(
                source_url=f"{CDC}/annual/{args.variable}/",
                pipeline_version="dwd-pipeline 0.1.0",
                inputs=Path(args.cache),
                download_date=args.download_date,
            ),
        },
    }
    manifest = merge_dataset_manifest(out / "dataset.json", dataset)
    print(f"Wrote {out / 'dataset.json'} ({len(manifest['metrics'])} metrics, "
          f"{len(manifest['lods'])} LODs)", file=sys.stderr)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True)
    parser.add_argument("--years", default="2001-2025",
                        help="e.g. 2001-2025 or 1991,2001,2011,2021")
    parser.add_argument("--variable", default="precipitation")
    parser.add_argument("--period", default="17", help="DWD period code (17 = calendar year)")
    parser.add_argument("--cache", default="downloads", help="where the .asc.gz grids live")
    parser.add_argument("--no-fetch", action="store_true", help="use the cache only")
    parser.add_argument("--resolutions", default="8,7", help="finest first")
    parser.add_argument("--tiled", default="8", help="resolutions written as tiles")
    parser.add_argument("--scale", type=float, default=1.0, help="factor applied to grid values")
    parser.add_argument("--metric-prefix", default="rain_mm")
    parser.add_argument("--label", default="Annual precipitation")
    parser.add_argument("--unit", default="mm")
    parser.add_argument("--dataset-id", default="rain")
    parser.add_argument("--dataset-title", default="Rain")
    parser.add_argument("--reference-date", default=None)
    parser.add_argument("--download-date", default=None)
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
