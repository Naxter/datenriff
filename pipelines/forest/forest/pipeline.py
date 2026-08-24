"""FOREST — Germany's forest and what has happened to it since 1985.

Reads the European Forest Disturbance Atlas (Landsat, 30 m, 1985-2023) and
writes the atlas binary format: H3 cells, three metrics, stats,
``dataset.json``.

    PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m forest.pipeline \
        --input downloads/germany --country germany \
        --out ../../apps/web/public/data/forest

Metrics per cell:

    forest_share       forest area / cell area
    disturbed_share    of that forest, the part disturbed at least once
    disturbance_agent  the cause that took the most of it, plus dominance

Counts are pooled, never shares: an r7 cell adds up the pixels of its
children and divides once, so the country view and the tile view agree.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import subprocess
import sys
from collections import defaultdict
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
from zensus_pipeline.tiling import (
    group_by_tile,
    merge_tile_index,
    write_tile_metric,
    write_tile_positions,
)

from . import raster

H3_EDGE_METERS = {5: 8544.4, 6: 3229.5, 7: 1220.6, 8: 461.4, 9: 174.4, 10: 65.9}
TILE_PARENT_RES = 5
PIXEL_AREA_KM2 = 0.0009  # 30 m x 30 m
LICENSE = "CC BY 4.0"
SOURCE_URL = "https://zenodo.org/records/13333034"
ATTRIBUTION = "European Forest Disturbance Atlas (Viana-Soto & Senf)"
#: Landsat pixels are 30 m; the atlas maps disturbance patches, not pixels
SPATIAL_RESOLUTION_METERS = 30

#: columns of the per-cell count vector
FOREST, DISTURBED = 0, 1
AGENT0 = 2
WIDTH = AGENT0 + len(raster.AGENT_CODES)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def accumulate(chunks, source_crs: str, base_res: int, log=lambda _m: None):
    """Counts per H3 cell at ``base_res``, summed over every block."""
    cells: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(WIDTH, dtype="int64"))
    blocks = 0
    for chunk in chunks:
        lons, lats = raster.to_lonlat(chunk.xs, chunk.ys, source_crs)
        for i in range(len(chunk.forest)):
            cell = h3.latlng_to_cell(float(lats[i]), float(lons[i]), base_res)
            row = cells[cell]
            row[FOREST] += chunk.forest[i]
            row[DISTURBED] += chunk.disturbed[i]
            row[AGENT0:] += chunk.agents[i]
        blocks += len(chunk.forest)
        if blocks % 2_000_000 < len(chunk.forest):
            log(f"  {blocks:,} blocks, {len(cells):,} cells")
    return dict(cells), blocks


def to_parent(cells: dict[str, np.ndarray], res: int) -> dict[str, np.ndarray]:
    """Pool counts one or more levels up."""
    out: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(WIDTH, dtype="int64"))
    for cell, counts in cells.items():
        out[h3.cell_to_parent(cell, res)] += counts
    return dict(out)


def metrics_of(counts: np.ndarray, cell: str) -> tuple[float, float | None, int | None, int]:
    """(forest share of the cell, disturbed share of that forest, agent, dominance)."""
    forest = float(counts[FOREST])
    area = h3.cell_area(cell, unit="km^2")
    forest_share = min(forest * PIXEL_AREA_KM2 / area, 1.0) if area > 0 else 0.0
    if forest <= 0:
        return forest_share, None, None, 0
    disturbed = float(counts[DISTURBED])
    disturbed_share = disturbed / forest
    agents = counts[AGENT0:]
    if agents.sum() <= 0:
        # forest that has never been disturbed has no cause to name
        return forest_share, disturbed_share, None, 0
    dominant = int(np.argmax(agents))
    dominance = float(agents[dominant]) / float(agents.sum())
    return forest_share, disturbed_share, dominant, round(dominance * 255)


def run(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    resolutions = sorted({int(r) for r in args.resolutions.split(",")}, reverse=True)
    base_res = resolutions[0]
    country_res = min(resolutions)
    tiled = {int(r) for r in args.tiled.split(",") if r.strip()} if args.tiled else set()

    paths = raster.open_set(Path(args.input), args.country)
    log(f"FOREST: {args.country} -> H3 r{base_res}")
    chunks = raster.read_blocks(paths, block=args.block, log=log)
    cells, blocks = accumulate(chunks, args.source_crs, base_res, log=log)
    if not cells:
        raise SystemExit("no forest pixels found - check --input and --country")
    log(f"  {blocks:,} blocks with forest -> {len(cells):,} r{base_res} cells")

    metric_entries: list[dict] = []
    lod_fragments: list[dict] = []
    per_res = {base_res: cells}
    for res in resolutions[1:]:
        per_res[res] = to_parent(cells, res)

    for res in resolutions:
        at_res = per_res[res]
        res_dir = out / f"r{res}"
        res_dir.mkdir(parents=True, exist_ok=True)
        cells_file = res_dir / "cells.txt"
        if cells_file.exists():
            universe = cells_file.read_text(encoding="utf-8").split()
            dropped = len(set(at_res) - set(universe))
            if dropped:
                log(f"  r{res}: {dropped:,} cells outside the existing universe dropped")
        else:
            universe = sorted(at_res)
            cells_file.write_text("\n".join(universe), encoding="utf-8")
        positions = [
            (round(lon, 6), round(lat, 6))
            for lon, lat in (
                (h3.cell_to_latlng(cell)[1], h3.cell_to_latlng(cell)[0]) for cell in universe
            )
        ]
        write_positions(res_dir / "positions.bin", positions)

        forest_share: list[float | None] = []
        disturbed_share: list[float | None] = []
        agent: list[int | None] = []
        dominance: list[int] = []
        for cell in universe:
            counts = at_res.get(cell)
            if counts is None:
                # carried by the universe, no forest here: missing, not zero
                forest_share.append(None)
                disturbed_share.append(None)
                agent.append(None)
                dominance.append(0)
                continue
            share, dist, dominant, strength = metrics_of(counts, cell)
            forest_share.append(share)
            disturbed_share.append(dist)
            agent.append(dominant)
            dominance.append(strength)

        write_f32(res_dir / "forest_share.f32", forest_share)
        write_f32(res_dir / "disturbed_share.f32", disturbed_share)
        write_u8(res_dir / "disturbance_agent.u8", agent)
        write_u8(res_dir / "disturbance_agent_dominance.u8", dominance)
        stats_by_metric = {
            "forest_share": compute_stats(forest_share),
            "disturbed_share": compute_stats(disturbed_share),
            "disturbance_agent": compute_stats(agent),
            "disturbance_agent_dominance": compute_stats(dominance),
        }
        metric_files = [
            ("forest_share.f32", forest_share, "f32"),
            ("disturbed_share.f32", disturbed_share, "f32"),
            ("disturbance_agent.u8", agent, "u8"),
            ("disturbance_agent_dominance.u8", dominance, "u8"),
        ]
        if res == country_res:
            metric_entries.extend([
                {
                    "id": "forest_share",
                    "label": "Forest cover",
                    "unit": None,
                    "storage": "f32",
                    "aggregation": "share",
                    "stats": stats_by_metric["forest_share"],
                },
                {
                    "id": "disturbed_share",
                    "label": "Forest disturbed since 1985",
                    "unit": None,
                    "storage": "f32",
                    "aggregation": "share",
                    "stats": stats_by_metric["disturbed_share"],
                },
                {
                    "id": "disturbance_agent",
                    "label": "Disturbance cause",
                    "storage": "u8",
                    "aggregation": "categoricalDominant",
                    "categories": list(raster.AGENT_LABELS),
                    "stats": stats_by_metric["disturbance_agent"],
                },
                {
                    "id": "disturbance_agent_dominance",
                    "label": "Disturbance cause dominance",
                    "storage": "u8",
                    "aggregation": "weightedMean",
                    "stats": stats_by_metric["disturbance_agent_dominance"],
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
            "referenceDate": args.reference_date,
            "provenance": provenance(
                source_url=SOURCE_URL,
                pipeline_version="forest-pipeline 0.1.0",
                inputs=paths,
                download_date=args.download_date,
            ),
        },
    }
    manifest = merge_dataset_manifest(out / "dataset.json", dataset)
    log(f"Wrote {out / 'dataset.json'} "
        f"({len(manifest['metrics'])} metrics, {len(manifest['lods'])} LODs)")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, help="directory holding the country's GeoTIFFs")
    parser.add_argument("--country", default="germany", help="the suffix in the file names")
    parser.add_argument("--out", required=True)
    parser.add_argument("--resolutions", default="8,7")
    parser.add_argument("--tiled", default="8")
    parser.add_argument("--block", type=int, default=raster.DEFAULT_BLOCK,
                        help="pixels per side of a reduction block")
    parser.add_argument("--source-crs", default="EPSG:3035")
    parser.add_argument("--dataset-id", default="forest")
    parser.add_argument("--dataset-title", default="Forest and disturbance")
    parser.add_argument("--attribution", default=ATTRIBUTION)
    parser.add_argument("--reference-date", default="2023-12-31")
    parser.add_argument("--download-date", default=None)
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
