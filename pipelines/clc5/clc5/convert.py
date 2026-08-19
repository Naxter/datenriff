"""Shapefile -> GeoPackage, so the pipeline only ever reads one format.

CLC5 2021 is published as a GeoPackage; 2012, 2015 and 2018 only as
shapefiles. Rather than carry a second parser, the older vintages are
converted once and then read by `gpkg.py` like everything else. That also
sidesteps the shapefile hole rule: a shapefile marks a hole by the
direction its ring winds, WKB by the ring's position, and getting that
wrong turns a lake inside a forest into forest.

This is the only place in the repo that needs GDAL, and it is a tool, not
part of the pipeline — nothing under `clc5/` imports it except this file:

    ../zensus/.venv/Scripts/pip install pyogrio

pyogrio ships its own GDAL on every platform, Windows included, so there
is nothing to install system-wide.

Features are copied in chunks: a whole vintage is several gigabytes of
geometry and does not need to be in memory at once.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

DEFAULT_CHUNK = 25_000


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def convert(
    sources: Path | list[Path],
    target: Path,
    layer: str | None = None,
    chunk: int = DEFAULT_CHUNK,
    columns: list[str] | None = None,
) -> int:
    """Copy every feature of every source into one GeoPackage layer.

    A vintage can arrive as several shapefiles — 2012 is split into five,
    one per class group — and the atlas wants what 2021 already is: a
    single layer holding the whole country."""
    try:
        from pyogrio.raw import read, write
    except ImportError:  # pragma: no cover - the tool is optional
        raise SystemExit(
            "pyogrio is not installed. It brings its own GDAL:\n"
            "    ../zensus/.venv/Scripts/pip install pyogrio"
        ) from None

    if target.exists():
        raise SystemExit(f"{target} exists — remove it first, appending would double the data")
    if isinstance(sources, Path):
        sources = [sources]
    layer = layer or target.stem

    started = time.time()
    total = 0
    fields: list[str] | None = None
    for source in sources:
        meta = read(str(source), max_features=1, columns=columns)[0]
        source_fields = list(meta["fields"])
        if fields is None:
            fields = source_fields
            log(f"fields {fields}, {meta['geometry_type']}, {meta['crs']}")
        elif source_fields != fields:
            # one layer cannot hold two schemas, and silently keeping the
            # first would drop a column without saying so
            raise SystemExit(
                f"{source.name} has fields {source_fields}, expected {fields}"
            )
        written = 0
        while True:
            _, _, geometry, field_data = read(
                str(source), skip_features=written, max_features=chunk, columns=columns
            )
            if len(geometry) == 0:
                break
            write(
                str(target),
                geometry,
                list(field_data),
                fields,
                driver="GPKG",
                layer=layer,
                # a shapefile mixes Polygon and MultiPolygon; one type per layer
                geometry_type="MultiPolygon",
                promote_to_multi=True,
                crs=meta["crs"],
                append=total > 0,
            )
            written += len(geometry)
            total += len(geometry)
            if len(geometry) < chunk:
                break
        log(f"  {source.name}: {written:,} features ({time.time() - started:.0f}s)")
    log(f"Wrote {target} — {total:,} features in layer '{layer}'")
    return total


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--input", required=True, nargs="+",
                        help="source .shp files; several are merged into one layer")
    parser.add_argument("--out", required=True, help="target .gpkg")
    parser.add_argument("--layer", default=None, help="layer name (default: the file stem)")
    parser.add_argument("--chunk", type=int, default=DEFAULT_CHUNK, help="features per copy")
    parser.add_argument(
        "--columns", default=None,
        help="comma-separated attributes to keep; the default keeps all of them",
    )
    args = parser.parse_args(argv)
    convert(
        [Path(p) for p in args.input],
        Path(args.out),
        args.layer,
        args.chunk,
        [c.strip() for c in args.columns.split(",")] if args.columns else None,
    )


if __name__ == "__main__":
    main()
