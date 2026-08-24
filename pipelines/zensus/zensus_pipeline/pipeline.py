"""Zensus grid CSV -> H3 -> binary sculpture buffers.

Streams a 100 m grid CSV into H3 res-10 accumulators, aggregates to res
9/8 and writes cells.txt + positions.bin + metric buffers per resolution,
plus a dataset.json manifest fragment with provenance. The first metric
run defines the cell universe; later runs align to it so all buffers
share the same positions. Requires pyproj and h3 v4.

Rules:

  sum       counts (population, homes):
              --value-column Einwohner
  hmean     per-unit averages (persons per home): SUM(w)/SUM(w/v), so the
            units are pooled rather than the ratios averaged.
  wmean     averages (age, rent), weighted by a count. The weight comes
            from a column in the same file or from a second grid CSV
            joined on the grid id:
              --value-column Durchschnittsalter \\
              --weight-input Zensus2022_Bevoelkerungszahl_100m-Gitter.csv \\
              --weight-value-column Einwohner
  share     ratios (vacancy, share aged 65+). Pools numerator and
            denominator instead of averaging ratios:
              --numerator-column Leerstehend --denominator-column Wohnungen \\
              --min-denominator 25
  category  dominant category + dominance (heating), from per-category
            count columns:
              --category-columns "Gas,Heizoel,Fernwaerme,Waermepumpe,Strom,Biomasse"

Example (population):

    python -m zensus_pipeline.pipeline \\
        --input Zensus2022_Bevoelkerungszahl_100m-Gitter.csv \\
        --metric population_2022 --label "Population 2022" \\
        --out ../../apps/web/public/data/zensus
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import hashlib
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

from . import __version__
from .aggregate import (
    aggregate_harmonic_mean_to_parent,
    aggregate_categories_to_parent,
    aggregate_share_to_parent,
    aggregate_sum_to_parent,
    aggregate_weighted_mean_to_parent,
    categorical_dominant,
    share,
)
from .binning import (
    accumulate_harmonic,
    accumulate_categories,
    accumulate_share,
    accumulate_sum,
    accumulate_weighted,
    batched_cells,
)
from .binary_writer import (
    bounds_of,
    compute_stats,
    merge_dataset_manifest,
    write_f32,
    write_positions,
    write_u8,
)
from .gridref import find_centre_columns, find_grid_id_column, parse_grid_id
from .provenance import provenance
from .special_values import parse_value
from .tiling import (
    group_by_tile,
    merge_tile_index,
    write_tile_metric,
    write_tile_positions,
)

BASE_RESOLUTION = 10
# r7 is the mobile country LOD (~5 km² cells), r8 the desktop one
COARSE_RESOLUTIONS = (9, 8, 7)
H3_EDGE_METERS = {7: 1220.6, 8: 461.4, 9: 174.4, 10: 65.9}
# finer LODs ship as tiles grouped by this H3 parent resolution
TILED_RESOLUTIONS = frozenset({9, 10})
TILE_PARENT_RES = 5
WEIGHT_KEY = "__weight"


def open_reader(path: Path, encoding: str, delimiter: str):
    fh = path.open("r", encoding=encoding, newline="")
    return fh, csv.DictReader(fh, delimiter=delimiter)


def row_key(row: dict, id_col: str | None, x: float, y: float) -> str:
    if id_col:
        return row[id_col].strip()
    return f"{x:.0f}:{y:.0f}"


def stream_rows(
    path: Path,
    columns: list[str],
    encoding: str,
    delimiter: str,
    weight_lookup: dict[str, float] | None = None,
    extra_missing: frozenset[str] | None = None,
) -> Iterator[tuple[float, float, dict]]:
    """Yield (x_3035, y_3035, payload) per row; payload holds parsed floats."""
    fh, reader = open_reader(path, encoding, delimiter)
    with fh:
        fieldnames = reader.fieldnames or []
        missing = [c for c in columns if c not in fieldnames]
        if missing:
            raise SystemExit(f"Columns {missing} not found; available: {fieldnames}")
        centre_cols = find_centre_columns(fieldnames)
        id_col = find_grid_id_column(fieldnames)
        if not centre_cols and not id_col:
            raise SystemExit(f"No grid id or centre columns found in {fieldnames}")

        skipped = 0
        for i, row in enumerate(reader, 1):
            if centre_cols:
                x = parse_value(row.get(centre_cols[0]))
                y = parse_value(row.get(centre_cols[1]))
                # A nil dash parses to 0.0, which is a valid float but not a
                # position: EPSG:3035 over Germany is millions of metres.
                if not x or not y:
                    skipped += 1
                    continue
            else:
                assert id_col is not None
                x, y = parse_grid_id(row[id_col]).centroid
            payload = {c: parse_value(row.get(c), extra_missing) for c in columns}
            if weight_lookup is not None:
                payload[WEIGHT_KEY] = weight_lookup.get(row_key(row, id_col, x, y))
            yield x, y, payload
            if i % 1_000_000 == 0:
                print(f"  {i:,} rows …", file=sys.stderr)
        if skipped:
            print(f"  {skipped:,} rows without coordinates skipped", file=sys.stderr)


def load_weight_lookup(
    path: Path, value_column: str, encoding: str, delimiter: str
) -> dict[str, float]:
    """Grid-id keyed weights from a second grid CSV (e.g. population)."""
    print(f"Loading weights from {path.name} …", file=sys.stderr)
    fh, reader = open_reader(path, encoding, delimiter)
    lookup: dict[str, float] = {}
    with fh:
        fieldnames = reader.fieldnames or []
        if value_column not in fieldnames:
            raise SystemExit(
                f"Weight column {value_column!r} not found; available: {fieldnames}"
            )
        centre_cols = find_centre_columns(fieldnames)
        id_col = find_grid_id_column(fieldnames)
        for row in reader:
            value = parse_value(row.get(value_column))
            if value is None:
                continue
            if id_col:
                lookup[row[id_col].strip()] = value
            elif centre_cols:
                x = parse_value(row.get(centre_cols[0]))
                y = parse_value(row.get(centre_cols[1]))
                if x and y:
                    lookup[f"{x:.0f}:{y:.0f}"] = value
    print(f"  {len(lookup):,} weight cells", file=sys.stderr)
    return lookup


def make_cell_of_batch():
    import h3  # lazy, so the pure modules import without the dependency
    from pyproj import Transformer

    transformer = Transformer.from_crs("EPSG:3035", "EPSG:4326", always_xy=True)

    def cell_of_batch(xs, ys):
        lons, lats = transformer.transform(list(xs), list(ys))
        return [
            h3.latlng_to_cell(lat, lon, BASE_RESOLUTION)
            for lon, lat in zip(lons, lats)
        ]

    return cell_of_batch


def load_universe(res_dir: Path) -> list[str] | None:
    cells_file = res_dir / "cells.txt"
    if not cells_file.exists():
        return None
    return cells_file.read_text(encoding="utf-8").split()


def write_universe(res_dir: Path, cells: list[str]) -> None:
    import h3

    res_dir.mkdir(parents=True, exist_ok=True)
    (res_dir / "cells.txt").write_text("\n".join(cells), encoding="utf-8")
    lonlat = []
    for cell in cells:
        lat, lon = h3.cell_to_latlng(cell)
        lonlat.append((round(lon, 6), round(lat, 6)))
    write_positions(res_dir / "positions.bin", lonlat)


def positions_for(cells: list[str]) -> list[tuple[float, float]]:
    import h3

    result = []
    for cell in cells:
        lat, lon = h3.cell_to_latlng(cell)
        result.append((lon, lat))
    return result


def write_tiles(
    res: int,
    res_dir: Path,
    universe: list[str],
    metric_files: list[tuple[str, list, str]],
    metric_stats: dict[str, dict],
) -> None:
    """Group the universe by H3 parent and write per-tile buffers + index."""
    import h3

    groups = group_by_tile(
        universe, lambda cell: h3.cell_to_parent(cell, TILE_PARENT_RES)
    )
    first_run = not (res_dir / "index.json").exists()
    tile_bounds = (
        write_tile_positions(res_dir, groups, positions_for(universe))
        if first_run
        else None
    )
    for file_name, aligned, storage in metric_files:
        write_tile_metric(res_dir, groups, file_name, aligned, storage)
    merge_tile_index(
        res_dir,
        res,
        H3_EDGE_METERS[res],
        tile_bounds,
        {tile_id: len(indices) for tile_id, indices in groups.items()},
        metric_stats,
    )
    if first_run:
        print(f"  r{res}: {len(groups):,} tiles", file=sys.stderr)


def ensure_universe(res_dir: Path, cells_at_level: dict) -> list[str]:
    universe = load_universe(res_dir)
    if universe is None:
        universe = sorted(cells_at_level)
        write_universe(res_dir, universe)
    else:
        dropped = len(set(cells_at_level) - set(universe))
        if dropped:
            print(
                f"  {dropped:,} cells outside the existing universe dropped "
                "(the universe is defined by the first metric run)",
                file=sys.stderr,
            )
    return universe


def run(args: argparse.Namespace) -> None:
    import h3

    input_path = Path(args.input)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cell_of_batch = make_cell_of_batch()

    # columns + optional weight source per rule
    weight_lookup = None
    if args.rule == "sum":
        columns = [args.value_column]
    elif args.rule in ("wmean", "hmean"):
        columns = [args.value_column]
        if args.weight_input:
            weight_lookup = load_weight_lookup(
                Path(args.weight_input),
                args.weight_value_column,
                args.encoding,
                args.delimiter,
            )
            weight_key = WEIGHT_KEY
        elif args.weight_column:
            columns.append(args.weight_column)
            weight_key = args.weight_column
        else:
            raise SystemExit(f"{args.rule} needs --weight-column or --weight-input")
    elif args.rule == "share":
        if not args.numerator_column or not args.denominator_column:
            raise SystemExit("share needs --numerator-column and --denominator-column")
        columns = [args.numerator_column, args.denominator_column]
    elif args.rule == "category":
        if not args.category_columns:
            raise SystemExit("category needs --category-columns")
        columns = [c.strip() for c in args.category_columns.split(",")]
    else:
        raise SystemExit(f"Unknown rule: {args.rule}")

    extra_missing = (
        frozenset(t.strip() for t in args.treat_missing.split(","))
        if args.treat_missing
        else None
    )
    print(f"Streaming {input_path.name} ({args.rule}) …", file=sys.stderr)
    rows = stream_rows(
        input_path, columns, args.encoding, args.delimiter, weight_lookup, extra_missing
    )
    cell_payloads = batched_cells(rows, cell_of_batch)

    parent_of = lambda cell, res: h3.cell_to_parent(cell, res)  # noqa: E731
    write_resolutions = list(COARSE_RESOLUTIONS) + (
        [BASE_RESOLUTION] if args.write_r10 else []
    )
    country_res = min(write_resolutions)

    metric_entries: list[dict] = []
    lod_fragments: list[dict] = []

    if args.rule == "sum":
        base = accumulate_sum(cell_payloads, args.value_column)
        print(f"  {len(base):,} res-{BASE_RESOLUTION} cells", file=sys.stderr)
        for res in write_resolutions:
            values = (
                dict(base)
                if res == BASE_RESOLUTION
                else aggregate_sum_to_parent(base, lambda c, r=res: parent_of(c, r))
            )
            res_dir = out / f"r{res}"
            universe = ensure_universe(res_dir, values)
            aligned = [values.get(cell) for cell in universe]
            write_f32(res_dir / f"{args.metric}.f32", aligned)
            stats = compute_stats(aligned, with_sum=True)
            if res == country_res:
                metric_entries.append(metric_entry(args, "f32", "sum", stats))
            if res in TILED_RESOLUTIONS:
                write_tiles(res, res_dir, universe,
                            [(f"{args.metric}.f32", aligned, "f32")],
                            {args.metric: stats})
            lod_fragments.append(lod_fragment(res, universe, {args.metric: stats}))

    elif args.rule == "wmean":
        means, weights = accumulate_weighted(cell_payloads, args.value_column, weight_key)
        print(f"  {len(means):,} res-{BASE_RESOLUTION} cells", file=sys.stderr)
        for res in write_resolutions:
            values = (
                dict(means)
                if res == BASE_RESOLUTION
                else aggregate_weighted_mean_to_parent(
                    means, weights, lambda c, r=res: parent_of(c, r)
                )
            )
            res_dir = out / f"r{res}"
            universe = ensure_universe(res_dir, values)
            aligned = [values.get(cell) for cell in universe]
            write_f32(res_dir / f"{args.metric}.f32", aligned)
            stats = compute_stats(aligned)
            if res == country_res:
                metric_entries.append(metric_entry(args, "f32", "weightedMean", stats))
            if res in TILED_RESOLUTIONS:
                write_tiles(res, res_dir, universe,
                            [(f"{args.metric}.f32", aligned, "f32")],
                            {args.metric: stats})
            lod_fragments.append(lod_fragment(res, universe, {args.metric: stats}))

    elif args.rule == "hmean":
        means, weights = accumulate_harmonic(cell_payloads, args.value_column, weight_key)
        print(f"  {len(means):,} res-{BASE_RESOLUTION} cells", file=sys.stderr)
        for res in write_resolutions:
            values = (
                dict(means)
                if res == BASE_RESOLUTION
                else aggregate_harmonic_mean_to_parent(
                    means, weights, lambda c, r=res: parent_of(c, r)
                )
            )
            res_dir = out / f"r{res}"
            universe = ensure_universe(res_dir, values)
            aligned = [values.get(cell) for cell in universe]
            write_f32(res_dir / f"{args.metric}.f32", aligned)
            stats = compute_stats(aligned)
            if res == country_res:
                metric_entries.append(metric_entry(args, "f32", "harmonicMean", stats))
            if res in TILED_RESOLUTIONS:
                write_tiles(res, res_dir, universe,
                            [(f"{args.metric}.f32", aligned, "f32")],
                            {args.metric: stats})
            lod_fragments.append(lod_fragment(res, universe, {args.metric: stats}))

    elif args.rule == "share":
        numerators, denominators = accumulate_share(
            cell_payloads, args.numerator_column, args.denominator_column
        )
        print(f"  {len(denominators):,} res-{BASE_RESOLUTION} cells", file=sys.stderr)
        for res in write_resolutions:
            if res == BASE_RESOLUTION:
                values = {
                    cell: share(
                        [(numerators.get(cell), denominators[cell])],
                        args.min_denominator,
                    )
                    for cell in denominators
                }
            else:
                values = aggregate_share_to_parent(
                    numerators,
                    denominators,
                    lambda c, r=res: parent_of(c, r),
                    args.min_denominator,
                )
            res_dir = out / f"r{res}"
            universe = ensure_universe(res_dir, values)
            aligned = [values.get(cell) for cell in universe]
            write_f32(res_dir / f"{args.metric}.f32", aligned)
            stats = compute_stats(aligned)
            if res == country_res:
                metric_entries.append(metric_entry(args, "f32", "share", stats))
            if res in TILED_RESOLUTIONS:
                write_tiles(res, res_dir, universe,
                            [(f"{args.metric}.f32", aligned, "f32")],
                            {args.metric: stats})
            lod_fragments.append(lod_fragment(res, universe, {args.metric: stats}))

    else:  # category
        labels = (
            [c.strip() for c in args.category_labels.split(",")]
            if args.category_labels
            else columns
        )
        base = accumulate_categories(cell_payloads, columns)
        print(f"  {len(base):,} res-{BASE_RESOLUTION} cells", file=sys.stderr)
        for res in write_resolutions:
            if res == BASE_RESOLUTION:
                dominant = {cell: categorical_dominant(c) for cell, c in base.items()}
            else:
                dominant = aggregate_categories_to_parent(
                    base, lambda c, r=res: parent_of(c, r)
                )
            res_dir = out / f"r{res}"
            universe = ensure_universe(res_dir, dominant)
            cats = []
            doms = []
            for cell in universe:
                entry = dominant.get(cell)
                if entry is None:
                    cats.append(None)
                    doms.append(0)
                else:
                    cats.append(entry[0])
                    doms.append(round(entry[1] * 255))
            write_u8(res_dir / f"{args.metric}_category.u8", cats)
            write_u8(res_dir / f"{args.metric}_dominance.u8", doms)
            cat_stats = {
                f"{args.metric}_category": compute_stats(cats),
                f"{args.metric}_dominance": compute_stats(doms),
            }
            if res in TILED_RESOLUTIONS:
                write_tiles(res, res_dir, universe,
                            [(f"{args.metric}_category.u8", cats, "u8"),
                             (f"{args.metric}_dominance.u8", doms, "u8")],
                            {f"{args.metric}_category": compute_stats(cats),
                             f"{args.metric}_dominance": compute_stats(doms)})
            if res == country_res:
                metric_entries.append(
                    {
                        "id": f"{args.metric}_category",
                        "label": args.label or args.metric,
                        "storage": "u8",
                        "aggregation": "categoricalDominant",
                        "categories": labels,
                        "stats": cat_stats[f"{args.metric}_category"],
                    }
                )
                metric_entries.append(
                    {
                        "id": f"{args.metric}_dominance",
                        "label": f"{args.label or args.metric} dominance",
                        "storage": "u8",
                        "aggregation": "weightedMean",
                        "stats": cat_stats[f"{args.metric}_dominance"],
                    }
                )
            lod_fragments.append(lod_fragment(res, universe, cat_stats))

    fragment = {
        "id": args.dataset_id,
        "title": args.dataset_title,
        "spatialResolution": 100,
        "metrics": metric_entries,
        "lods": lod_fragments,
        "source": {
            "label": args.attribution,
            "url": "https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Zensus2022/_inhalt.html",
            "license": "Datenlizenz Deutschland – Namensnennung – Version 2.0",
            "provenance": provenance(
                source_url=args.source_url,
                pipeline_version=f"zensus-pipeline {__version__}",
                inputs=input_path,
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


def metric_entry(args: argparse.Namespace, storage: str, rule: str, stats: dict) -> dict:
    return {
        "id": args.metric,
        "label": args.label or args.metric,
        "unit": args.unit,
        "storage": storage,
        "aggregation": rule,
        "stats": stats,
    }


def lod_fragment(res: int, universe: list[str], metric_stats: dict | None = None) -> dict:
    fragment = {
        "resolution": res,
        "count": len(universe),
        "bounds": bounds_of(positions_for(universe)),
        "cellRadiusMeters": H3_EDGE_METERS[res],
        # r7/r8 are both country LODs — the client picks by quality profile;
        # r10 waits for district zoom: below ~10 its 66 m cells are a pixel
        # wide and read as haze, and one viewport would pull ~150 tiles
        "minZoom": 0 if res <= 8 else (7.0 if res == 9 else 10.2),
        "positions": f"r{res}/positions.bin",
        "metricTemplate": f"r{res}/{{metric}}",
    }
    if metric_stats:
        # per-LOD stats: r7 cells pool ~4x the people of r8 cells, so height
        # and colour must calibrate against the resolution being drawn
        fragment["metricStats"] = metric_stats
    if res in TILED_RESOLUTIONS:
        fragment.update(
            {
                "tileIndex": f"r{res}/index.json",
                "tileTemplate": f"r{res}/tiles/{{tile}}.{{metric}}",
                "positionsTemplate": f"r{res}/tiles/{{tile}}.positions.bin",
                "tileParentResolution": TILE_PARENT_RES,
            }
        )
    return fragment


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Zensus grid CSV file")
    parser.add_argument("--metric", required=True, help="Metric id, e.g. population_2022")
    parser.add_argument(
        "--rule", default="sum", choices=["sum", "wmean", "hmean", "share", "category"]
    )
    parser.add_argument("--label", help="Human-readable metric label")
    parser.add_argument("--unit")
    parser.add_argument("--value-column", default="Einwohner")
    parser.add_argument("--weight-column", help="wmean: weight column in the same file")
    parser.add_argument("--weight-input", help="wmean: grid CSV to take weights from")
    parser.add_argument("--weight-value-column", default="Einwohner")
    parser.add_argument("--numerator-column", help="share: counted subset, e.g. vacant dwellings")
    parser.add_argument("--denominator-column", help="share: total, e.g. all dwellings")
    parser.add_argument(
        "--min-denominator",
        type=float,
        default=0.0,
        help="share: suppress cells whose pooled denominator stays below this",
    )
    parser.add_argument("--category-columns", help="category: comma-separated count columns")
    parser.add_argument("--category-labels", help="category: display labels (default: columns)")
    parser.add_argument("--out", required=True, help="Output dataset directory")
    parser.add_argument("--dataset-id", default="zensus")
    parser.add_argument("--dataset-title", default="Zensus")
    parser.add_argument("--attribution", default="Data: Destatis, Zensus 2022")
    parser.add_argument("--source-url", help="Exact download URL, for provenance")
    parser.add_argument("--download-date", help="ISO date the source was downloaded")
    parser.add_argument("--encoding", default="utf-8-sig")
    parser.add_argument("--delimiter", default=";")
    parser.add_argument(
        "--treat-missing",
        help="comma-separated extra missing markers, e.g. \"-1\" for the 2011 grid",
    )
    parser.add_argument(
        "--write-r10",
        action="store_true",
        help="Also write untiled res-10 buffers (large; tiling comes later)",
    )
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
