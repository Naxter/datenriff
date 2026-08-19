"""BKG CLC5 land cover -> H3 -> binary sculpture buffers.

    GeoPackage (SQLite + WKB, EPSG:25832)
     -> polygon rings reprojected to WGS84
     -> H3 r10 coverage per polygon, counted per class group
     -> pooled to the output LODs: artificial share, dominant class
     -> stats + binary + dataset.json

CLC5 is CORINE Land Cover at 5 ha for Germany, published by the BKG for
2012, 2015, 2018 and 2021 (DL-DE-BY-2.0, no login). Every vintage becomes
its own metric (`built_share_<year>`, `land_class_<year>`), so several
years played in sequence give the change story without a code change.

The country LOD is r7 and r8 is written as tiles: the app loads every
metric of the country LOD up front.

The binary writer and the tiled writer are shared with the census
pipeline (pip install -e pipelines/zensus).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import subprocess
import sys
from pathlib import Path

import h3
import numpy as np
from zensus_pipeline.binary_writer import (
    bounds_of,
    compute_stats,
    merge_dataset_manifest,
    write_f32,
    write_positions,
    write_u8,
)
from zensus_pipeline.tiling import (
    group_by_tile,
    merge_tile_index,
    write_tile_metric,
    write_tile_positions,
)

from . import classes, coverage, gpkg

H3_EDGE_METERS = {5: 8544.4, 6: 3229.5, 7: 1220.6, 8: 461.4}
TILE_PARENT_RES = 5
LICENSE = "Datenlizenz Deutschland - Namensnennung - Version 2.0"
SOURCE_URL = "https://gdz.bkg.bund.de/index.php/default/corine-land-cover-5-ha-clc5.html"
#: CLC5's minimum mapping unit is 5 ha; as a length that is ~224 m
SPATIAL_RESOLUTION_METERS = 224


def git_commit() -> str | None:
    try:
        return (
            subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                           capture_output=True, text=True, check=True).stdout.strip()
            or None
        )
    except (OSError, subprocess.CalledProcessError):
        return None


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def metric_names(prefix: str, year: int) -> dict[str, str]:
    return {
        "built": f"{prefix}_share_{year}",
        "category": f"land_class_{year}",
        "dominance": f"land_class_dominance_{year}",
    }


def run(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    resolutions = sorted({int(r) for r in args.resolutions.split(",")}, reverse=True)
    base_res = resolutions[0]
    country_res = min(resolutions)
    tiled = {int(r) for r in args.tiled.split(",") if r.strip()} if args.tiled else set()
    year = int(args.year)
    names = metric_names(args.metric_prefix, year)

    log(f"CLC5 {year}: {Path(args.input).name} -> H3 r{coverage.FINE_RES} coverage")
    features = gpkg.read_features(Path(args.input), args.table, args.attribute, limit=args.limit)
    counts, fine_cells = coverage.accumulate(
        features, classes.GROUP_OF_CODE, args.source_crs, base_res, len(classes.LABELS), log=log
    )
    if not counts:
        raise SystemExit("no cells covered - check --table, --attribute and --source-crs")
    log(f"  {fine_cells:,} fine cells -> {len(counts):,} r{base_res} cells")

    metric_entries: list[dict] = []
    lod_fragments: list[dict] = []
    per_res = {base_res: counts}
    for res in resolutions[1:]:
        per_res[res] = coverage.to_parent(counts, res)

    for res in resolutions:
        cells = per_res[res]
        universe = sorted(cells)
        res_dir = out / f"r{res}"
        res_dir.mkdir(parents=True, exist_ok=True)
        (res_dir / "cells.txt").write_text("\n".join(universe), encoding="utf-8")
        positions = [
            (round(lon, 6), round(lat, 6))
            for lon, lat in (
                (h3.cell_to_latlng(cell)[1], h3.cell_to_latlng(cell)[0]) for cell in universe
            )
        ]
        write_positions(res_dir / "positions.bin", positions)

        built: list[float | None] = []
        category: list[int | None] = []
        dominance: list[int] = []
        for cell in universe:
            share, dominant, strength = coverage.shares(cells[cell], classes.ARTIFICIAL_GROUPS)
            built.append(None if np.isnan(share) else share)
            category.append(None if dominant < 0 else dominant)
            dominance.append(round(strength * 255))

        write_f32(res_dir / f"{names['built']}.f32", built)
        write_u8(res_dir / f"{names['category']}.u8", category)
        write_u8(res_dir / f"{names['dominance']}.u8", dominance)
        stats_by_metric = {
            names["built"]: compute_stats(built),
            names["category"]: compute_stats(category),
            names["dominance"]: compute_stats(dominance),
        }
        metric_files = [
            (f"{names['built']}.f32", built, "f32"),
            (f"{names['category']}.u8", category, "u8"),
            (f"{names['dominance']}.u8", dominance, "u8"),
        ]
        if res == country_res:
            metric_entries.extend([
                {
                    "id": names["built"],
                    "label": f"Artificial surface {year}",
                    "unit": None,
                    "storage": "f32",
                    "aggregation": "share",
                    "stats": stats_by_metric[names["built"]],
                },
                {
                    "id": names["category"],
                    "label": f"Land cover {year}",
                    "storage": "u8",
                    "aggregation": "categoricalDominant",
                    "categories": list(classes.LABELS),
                    "stats": stats_by_metric[names["category"]],
                },
                {
                    "id": names["dominance"],
                    "label": f"Land cover dominance {year}",
                    "storage": "u8",
                    "aggregation": "weightedMean",
                    "stats": stats_by_metric[names["dominance"]],
                },
            ])

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
                res_dir, res, H3_EDGE_METERS[res], tile_bounds, counts_per_tile, stats_by_metric,
            )
            fragment.update({
                "tileIndex": f"r{res}/index.json",
                "tileTemplate": f"r{res}/tiles/{{tile}}.{{metric}}",
                "positionsTemplate": f"r{res}/tiles/{{tile}}.positions.bin",
                "tileParentResolution": TILE_PARENT_RES,
            })
            log(f"  r{res}: {len(groups):,} tiles")
        lod_fragments.append(fragment)
        log(f"  r{res}: {len(universe):,} cells")

    dataset = {
        "id": args.dataset_id,
        "title": args.dataset_title,
        "spatialResolution": SPATIAL_RESOLUTION_METERS,
        "metrics": metric_entries,
        "lods": lod_fragments,
        "source": {
            "label": args.attribution,
            "url": SOURCE_URL,
            "license": LICENSE,
            "referenceDate": args.reference_date or f"{year}-01-01",
            "provenance": {
                "sourceUrl": SOURCE_URL,
                "sourceHash": None,
                "downloadDate": args.download_date,
                "pipelineVersion": "clc5-pipeline 0.1.0",
                "gitCommit": git_commit(),
                "generatedAt": _dt.datetime.now(_dt.timezone.utc)
                .isoformat(timespec="seconds")
                .replace("+00:00", "Z"),
            },
        },
    }
    manifest = merge_dataset_manifest(out / "dataset.json", dataset)
    log(f"Wrote {out / 'dataset.json'} "
        f"({len(manifest['metrics'])} metrics, {len(manifest['lods'])} LODs)")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--input", required=True, help="CLC5 GeoPackage (.gpkg)")
    parser.add_argument("--year", required=True, help="vintage the file describes, e.g. 2021")
    parser.add_argument("--table", default="clc5ha_2021", help="feature table in the GeoPackage")
    parser.add_argument("--attribute", default="CLC21", help="column holding the CLC code")
    parser.add_argument("--source-crs", default="EPSG:25832", help="CRS of the geometries")
    parser.add_argument("--out", required=True, help="output dataset directory")
    parser.add_argument("--resolutions", default="8,7",
                        help="comma-separated H3 resolutions, finest first")
    parser.add_argument("--tiled", default="8", help="resolutions written as tiles")
    parser.add_argument("--metric-prefix", default="built")
    parser.add_argument("--limit", type=int, default=None, help="only the first N features (dev)")
    parser.add_argument("--dataset-id", default="land")
    parser.add_argument("--dataset-title", default="Land")
    parser.add_argument("--reference-date", default=None)
    parser.add_argument("--attribution", default="Data: GeoBasis-DE / BKG, CLC5")
    parser.add_argument("--download-date")
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
