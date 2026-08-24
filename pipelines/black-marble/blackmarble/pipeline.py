"""NASA Black Marble night lights -> H3 -> binary sculpture buffers.

    per year: raster pixels over the bbox (clipped to the atlas outline)
     -> per-pixel radiance / brightness
     -> H3 cell of the pixel centre
     -> mean per cell (an intensity: two pixels of 30 do not make 60)
     -> aggregate to coarser resolutions
    all years share one cell universe (the union of everything ever lit)
     -> stats + binary (light_{year}.f32) + dataset.json

The country LOD is r7: the app loads every metric of a dataset up front,
so fourteen years of r8 would be tens of megabytes at start-up. r8 is
written as a tiled LOD (--tiled) and streamed on zoom instead.

Two sources:

- `--vnp46 --years 2012-2025`: the calibrated VNP46A4 annual composites
  (500 m, nW/cm²/sr; Earthdata login, see vnp46.py). This is the real
  data and gives the timeline.
- `--input <geotiff> --year 2016`: an 8-bit Black Marble *visualisation*
  (e.g. the Earth Observatory 3 km mosaic) — a picture, not a measurement,
  kept for offline demos. Its metric carries no unit.

Every year is written as its own metric `light_{year}`; the app reads the
years present and shows the latest, with a timeline when there are several.

The binary writer is shared with the census pipeline; install it first
(`pip install -e pipelines/zensus`).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import subprocess
import sys
from pathlib import Path

from zensus_pipeline.provenance import provenance
from zensus_pipeline.binary_writer import (
    bounds_of,
    compute_stats,
    merge_dataset_manifest,
    write_f32,
    write_positions,
)
from zensus_pipeline.tiling import (
    group_by_tile,
    merge_tile_index,
    write_tile_metric,
    write_tile_positions,
)

from .aggregate import accumulate_mean, aggregate_mean_to_parent

# H3 edge lengths in metres, for the renderer's column radius
H3_EDGE_METERS = {5: 8544.4, 6: 3229.5, 7: 1220.6, 8: 461.4}
TILE_PARENT_RES = 5
# ITU-R BT.709 luma: the composite is near-greyscale, but weighting keeps
# the faint blue-white city cores from being over- or under-read
LUMA = (0.2126, 0.7152, 0.0722)


def load_clip_rings(path: Path) -> list[list[tuple[float, float]]]:
    """Rings from the atlas boundary file ({"rings": [[[lon, lat], ...]]})."""
    import json

    data = json.loads(path.read_text(encoding="utf-8"))
    return [[(float(x), float(y)) for x, y in ring] for ring in data["rings"]]


def point_in_rings(lon: float, lat: float, rings) -> bool:
    """Even-odd test; the atlas boundary is a simple outline per ring."""
    for ring in rings:
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        if inside:
            return True
    return False


def mask_in_rings(lons, lats, rings):
    """point_in_rings for whole arrays: a boolean mask of the points inside
    any ring. The per-pixel version costs minutes over a 500 m grid."""
    import numpy as np

    lons = np.asarray(lons, dtype="float64")
    lats = np.asarray(lats, dtype="float64")
    inside_any = np.zeros(lons.shape, dtype=bool)
    for ring in rings:
        xs = np.array([p[0] for p in ring], dtype="float64")
        ys = np.array([p[1] for p in ring], dtype="float64")
        xj, yj = np.roll(xs, 1), np.roll(ys, 1)
        inside = np.zeros(lons.shape, dtype=bool)
        for i in range(len(ring)):
            straddles = (ys[i] > lats) != (yj[i] > lats)
            if not straddles.any():
                continue
            # only where the edge straddles the latitude: elsewhere the
            # denominator is zero and the crossing is not counted anyway
            dy = yj[i] - ys[i]
            cut = np.empty(lons.shape, dtype="float64")
            cut.fill(np.inf)
            np.divide((xj[i] - xs[i]) * (lats - ys[i]), dy, out=cut, where=straddles)
            inside ^= straddles & (lons < cut + xs[i])
        inside_any |= inside
    return inside_any


def sample_pixels(
    path: Path,
    bbox: tuple[float, float, float, float],
    floor: float,
    rings=None,
):
    """Yield (lon, lat, brightness) for pixel centres inside the bbox and,
    when given, inside the clip rings — the bbox alone drags in France,
    Poland and the North Sea."""
    import rasterio
    from rasterio.windows import from_bounds

    west, south, east, north = bbox
    with rasterio.open(path) as ds:
        window = from_bounds(west, south, east, north, ds.transform)
        data = ds.read(window=window)
        transform = ds.window_transform(window)
        bands = data.shape[0]
        rows, cols = data.shape[1], data.shape[2]
        print(f"  window {cols} x {rows} px, {bands} band(s)", file=sys.stderr)
        for r in range(rows):
            for c in range(cols):
                if bands >= 3:
                    value = (
                        LUMA[0] * float(data[0, r, c])
                        + LUMA[1] * float(data[1, r, c])
                        + LUMA[2] * float(data[2, r, c])
                    )
                else:
                    value = float(data[0, r, c])
                if value <= floor:
                    continue
                # pixel centre
                lon = transform.c + transform.a * (c + 0.5)
                lat = transform.f + transform.e * (r + 0.5)
                if rings is not None and not point_in_rings(lon, lat, rings):
                    continue
                yield lon, lat, value


def year_samples(args: argparse.Namespace, year: int, bbox, rings):
    """(lon, lat, value) generator for one year from the chosen source."""
    if args.vnp46:
        from .vnp46 import DEFAULT_KEEP_QUALITY, sample_year

        keep = (
            tuple(int(q) for q in args.keep_quality.split(","))
            if args.keep_quality
            else DEFAULT_KEEP_QUALITY
        )
        return sample_year(
            year, Path(args.tiles_dir), bbox, args.floor, keep, rings, fetch=not args.no_fetch
        )
    return sample_pixels(Path(args.input), bbox, args.floor, rings)


def parse_years(spec: str) -> list[int]:
    """'2012-2015,2020' -> [2012, 2013, 2014, 2015, 2020]."""
    years: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            years.update(range(int(a), int(b) + 1))
        else:
            years.add(int(part))
    if not years:
        raise SystemExit("no years given")
    return sorted(years)


def run(args: argparse.Namespace) -> None:
    import h3

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    resolutions = sorted({int(r) for r in args.resolutions.split(",")}, reverse=True)
    base_res = resolutions[0]
    bbox = tuple(float(v) for v in args.bbox.split(","))  # type: ignore[assignment]
    years = parse_years(args.years) if args.vnp46 else [int(args.year)]
    if not args.vnp46 and not args.input:
        raise SystemExit("either --input <geotiff> or --vnp46 is required")

    tiled = {int(r) for r in args.tiled.split(",") if r.strip()} if args.tiled else set()
    rings = load_clip_rings(Path(args.clip)) if args.clip else None
    if rings:
        print(f"  clipping to {len(rings)} ring(s) from {Path(args.clip).name}",
              file=sys.stderr)

    # per year: mean per base cell; the universe is the union over all years
    per_year: dict[int, tuple[dict, dict]] = {}
    for year in years:
        print(f"Year {year}: streaming → H3 r{base_res} …", file=sys.stderr)
        samples = (
            (h3.latlng_to_cell(lat, lon, base_res), value)
            for lon, lat, value in year_samples(args, year, bbox, rings)  # type: ignore[arg-type]
        )
        means, counts = accumulate_mean(samples)
        print(f"  {len(means):,} lit r{base_res} cells", file=sys.stderr)
        if not means:
            raise SystemExit(f"{year}: no lit pixels in the bbox — check --bbox and --floor")
        per_year[year] = (means, counts)

    metric_entries: list[dict] = []
    lod_fragments: list[dict] = []
    country_res = min(resolutions)

    for res in resolutions:
        values_by_year: dict[int, dict] = {}
        for year, (means, counts) in per_year.items():
            if res == base_res:
                values_by_year[year] = dict(means)
            else:
                values_by_year[year], _ = aggregate_mean_to_parent(
                    means, counts, lambda c, r=res: h3.cell_to_parent(c, r)
                )
        universe = sorted(set().union(*(v.keys() for v in values_by_year.values())))
        res_dir = out / f"r{res}"
        res_dir.mkdir(parents=True, exist_ok=True)
        (res_dir / "cells.txt").write_text("\n".join(universe), encoding="utf-8")
        positions = [(round(lon, 6), round(lat, 6)) for lon, lat in
                     ((h3.cell_to_latlng(cell)[1], h3.cell_to_latlng(cell)[0])
                      for cell in universe)]
        write_positions(res_dir / "positions.bin", positions)
        stats_by_metric: dict[str, dict] = {}
        metric_files: list[tuple[str, list[float], str]] = []
        for year, values in values_by_year.items():
            metric_id = f"{args.metric_prefix}_{year}"
            # a cell lit in some other year but not this one is dark, not
            # unknown: below the floor, like every pixel the floor dropped
            aligned = [values.get(cell, 0.0) for cell in universe]
            write_f32(res_dir / f"{metric_id}.f32", aligned)
            stats = compute_stats(aligned)
            stats_by_metric[metric_id] = stats
            metric_files.append((f"{metric_id}.f32", aligned, "f32"))
            if res == country_res:
                metric_entries.append(
                    {
                        "id": metric_id,
                        "label": f"{args.label} {year}",
                        "unit": args.unit,
                        "storage": "f32",
                        "aggregation": "weightedMean",
                        "stats": stats,
                    }
                )
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
            groups = group_by_tile(universe, lambda c: h3.cell_to_parent(c, TILE_PARENT_RES))
            counts_per_tile = {tile: len(idx) for tile, idx in groups.items()}
            tile_bounds = write_tile_positions(res_dir, groups, positions)
            for file_name, aligned, storage in metric_files:
                write_tile_metric(res_dir, groups, file_name, aligned, storage)
            merge_tile_index(
                res_dir, res, H3_EDGE_METERS[res], tile_bounds,
                counts_per_tile, stats_by_metric,
            )
            fragment.update({
                "tileIndex": f"r{res}/index.json",
                "tileTemplate": f"r{res}/tiles/{{tile}}.{{metric}}",
                "positionsTemplate": f"r{res}/tiles/{{tile}}.positions.bin",
                "tileParentResolution": TILE_PARENT_RES,
            })
            print(f"  r{res}: {len(groups):,} tiles", file=sys.stderr)
        lod_fragments.append(fragment)
        print(f"  r{res}: {len(universe):,} cells, {len(values_by_year)} year(s)", file=sys.stderr)

    if args.vnp46:
        source_url = "https://doi.org/10.5067/VIIRS/VNP46A4.002"
        # the granules CMR handed over are on disk; hashing them is what makes
        # a night-light map traceable to the composites it was built from
        source_inputs = Path(args.tiles_dir)
        licence = "NASA Black Marble (VNP46A4), free to use with attribution"
        spatial = 500
    else:
        source_url = args.source_url
        source_inputs = Path(args.input)
        licence = "NASA Earth Observatory, free to use with attribution"
        spatial = args.spatial_resolution
    fragment = {
        "id": args.dataset_id,
        "title": args.dataset_title,
        "spatialResolution": spatial,
        "metrics": metric_entries,
        "lods": lod_fragments,
        "source": {
            "label": args.attribution,
            "url": "https://doi.org/10.5067/VIIRS/VNP46A4.002",
            "license": licence,
            "referenceDate": args.reference_date or f"{years[-1]}-01-01",
            "provenance": provenance(
                source_url=source_url,
                pipeline_version="blackmarble-pipeline 0.2.0",
                inputs=source_inputs,
                download_date=args.download_date,
            ),
        },
    }
    manifest = merge_dataset_manifest(out / "dataset.json", fragment)
    print(
        f"Wrote {out / 'dataset.json'} "
        f"({len(manifest['metrics'])} metrics, {len(manifest['lods'])} LODs)",
        file=sys.stderr,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    src = parser.add_argument_group("source")
    src.add_argument("--input", help="Black Marble visualisation GeoTIFF (8-bit)")
    src.add_argument("--year", default="2016", help="year the GeoTIFF shows")
    src.add_argument("--vnp46", action="store_true",
                     help="read VNP46A4 annual tiles instead of a GeoTIFF")
    src.add_argument("--years", default="2012-2025",
                     help="VNP46A4 years, e.g. 2012-2024 or 2016,2020,2024")
    src.add_argument("--tiles-dir", default="downloads/vnp46a4",
                     help="where VNP46A4 .h5 tiles are (or get downloaded to)")
    src.add_argument("--no-fetch", action="store_true",
                     help="fail instead of downloading missing tiles")
    src.add_argument("--keep-quality", default=None,
                     help="VNP46A4 quality values to keep (default 0,2: "
                          "good + gap-filled; 1 = poor quality is dropped)")
    parser.add_argument("--out", required=True, help="Output dataset directory")
    parser.add_argument(
        "--bbox",
        default="5.8,47.2,15.1,55.1",
        help="west,south,east,north in WGS84 (default: Germany)",
    )
    parser.add_argument(
        "--resolutions", default="8,7", help="comma-separated H3 resolutions, finest first"
    )
    parser.add_argument("--tiled", default="8",
                        help="resolutions written as tiles and streamed on zoom")
    parser.add_argument("--metric-prefix", default="light",
                        help="metrics are written as <prefix>_<year>")
    parser.add_argument("--label", default="Night light")
    parser.add_argument("--unit", default=None,
                        help='e.g. "nW/cm²/sr" for VNP46A4; none for a visualisation')
    parser.add_argument(
        "--floor",
        type=float,
        default=2.0,
        help="drop pixels at or below this value (sensor floor / unlit); "
             "~15 for the 8-bit mosaic, ~0.5 nW/cm²/sr for VNP46A4",
    )
    parser.add_argument(
        "--clip",
        help="boundary JSON ({\"rings\": …}) to clip pixels to, e.g. the "
        "atlas outline in apps/web/public/data/boundary.json",
    )
    parser.add_argument("--dataset-id", default="afterdark")
    parser.add_argument("--dataset-title", default="After Dark")
    parser.add_argument("--spatial-resolution", type=int, default=3000)
    parser.add_argument("--reference-date", default=None)
    parser.add_argument("--attribution", default="Data: NASA Black Marble")
    parser.add_argument("--source-url")
    parser.add_argument("--download-date")
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
