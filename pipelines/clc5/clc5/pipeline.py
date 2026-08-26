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
from zensus_pipeline.provenance import provenance
from zensus_pipeline.binary_writer import (
    bounds_of,
    compute_stats,
    merge_dataset_manifest,
    write_f32,
    write_positions,
    write_u8,
)
from zensus_pipeline.tiling import H3_EDGE_METERS, TILE_PARENT_RES, write_tiled_lod

from . import classes, coverage, gpkg

LICENSE = "Datenlizenz Deutschland – Namensnennung – Version 2.0"
SOURCE_URL = (
    "https://gdz.bkg.bund.de/index.php/default/"
    "corine-land-cover-5-ha-stand-2021-clc5-2021.html"
)
#: BKG's terms want the word "BKG" in the source note linked to their site,
#: which is not where the dataset lives — so the credit carries both.
PROVIDER_URL = "https://www.bkg.bund.de"
DATASET_NAME = "CLC5-2021"
#: CLC5's minimum mapping unit is 5 ha; as a length that is ~224 m
SPATIAL_RESOLUTION_METERS = 224


def bkg_attribution(download_date: str | None) -> str:
    """BKG prescribes CLC5's source note as

        © GeoBasis-DE / BKG (Jahr des letzten Datenbezugs) dl-de/by-2-0

    The licence half is rendered by the app from `license`; the year has to
    come from the download, so a run without a download date refuses rather
    than stamping a year it cannot know.
    """
    if not download_date:
        raise SystemExit(
            "--download-date is required: BKG's source note has to carry the "
            "year of the last download"
        )
    return f"Data: © GeoBasis-DE / BKG {download_date[:4]}"


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
    attribution = args.attribution or bkg_attribution(args.download_date)

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
        res_dir = out / f"r{res}"
        res_dir.mkdir(parents=True, exist_ok=True)
        # vintages of one dataset must share a cell universe, or the buffers
        # of two years do not line up. The first vintage written defines it.
        cells_file = res_dir / "cells.txt"
        if cells_file.exists():
            universe = cells_file.read_text(encoding="utf-8").split()
            dropped = len(set(cells) - set(universe))
            if dropped:
                log(f"  r{res}: {dropped:,} cells outside the existing universe dropped")
        else:
            universe = sorted(cells)
            cells_file.write_text("\n".join(universe), encoding="utf-8")
        positions = [
            (round(lon, 6), round(lat, 6))
            for lon, lat in (
                (h3.cell_to_latlng(cell)[1], h3.cell_to_latlng(cell)[0]) for cell in universe
            )
        ]
        write_positions(res_dir / "positions.bin", positions)

        built: list[float | None] = []
        category: list[int | None] = []
        dominance: list[int | None] = []
        # a cell the universe carries but this vintage does not cover is
        # missing, not "nothing built": NaN renders as suppressed
        empty = np.zeros(len(classes.LABELS), dtype="int32")
        for cell in universe:
            share, dominant, strength = coverage.shares(
                cells.get(cell, empty), classes.ARTIFICIAL_GROUPS
            )
            built.append(None if np.isnan(share) else share)
            category.append(None if dominant < 0 else dominant)
            # an uncovered cell has no dominant class, so it has no
            # dominance either — 0 would enter the stats as measured
            dominance.append(None if dominant < 0 else round(strength * 255))

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
            tile_fragment, tile_count = write_tiled_lod(
                res_dir, res, universe, positions, metric_files, stats_by_metric,
                lambda c: h3.cell_to_parent(c, TILE_PARENT_RES),
            )
            fragment.update(tile_fragment)
            log(f"  r{res}: {tile_count:,} tiles")
        lod_fragments.append(fragment)
        log(f"  r{res}: {len(universe):,} cells")

    dataset = {
        "id": args.dataset_id,
        "title": args.dataset_title,
        "spatialResolution": SPATIAL_RESOLUTION_METERS,
        "metrics": metric_entries,
        "lods": lod_fragments,
        "source": {
            "label": attribution,
            "url": SOURCE_URL,
            "providerUrl": PROVIDER_URL,
            "datasetName": DATASET_NAME,
            "license": LICENSE,
            "referenceDate": args.reference_date or f"{year}-01-01",
            "provenance": provenance(
                source_url=SOURCE_URL,
                pipeline_version="clc5-pipeline 0.1.0",
                inputs=Path(args.input),
                download_date=args.download_date,
            ),
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
    parser.add_argument(
        "--attribution",
        default=None,
        help="source note; defaults to BKG's prescribed form for CLC5, "
        "\"© GeoBasis-DE / BKG <Jahr des letzten Datenbezugs>\"",
    )
    parser.add_argument("--download-date")
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
