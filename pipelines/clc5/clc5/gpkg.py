"""GeoPackage reader: SQLite + WKB, no GDAL, no geopandas.

A GeoPackage is a SQLite database. Each geometry cell holds a small
GeoPackage header (magic "GP", flags, srs id, optional envelope) followed
by plain WKB. That is little enough to parse here, and it keeps the
pipeline on the standard library plus numpy — the alternative is a 100 MB
GDAL wheel for one file format.

Only what CLC5 needs is implemented: Polygon (WKB 3) and MultiPolygon
(WKB 6), two dimensions. Anything else raises rather than guessing.
"""

from __future__ import annotations

import sqlite3
import struct
from collections.abc import Iterator
from pathlib import Path

import numpy as np

WKB_POLYGON = 3
WKB_MULTIPOLYGON = 6
#: envelope indicator (header flags bits 1-3) -> envelope size in bytes
ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}


def connect(path: Path) -> sqlite3.Connection:
    """Read-only connection; the file is opened, never written."""
    return sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)


def geometry_column(db: sqlite3.Connection, table: str) -> tuple[str, int]:
    """(geometry column name, srs id) for a feature table."""
    row = db.execute(
        "SELECT column_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?",
        (table,),
    ).fetchone()
    if not row:
        raise SystemExit(f"{table}: not a feature table in this GeoPackage")
    return row[0], int(row[1])


def feature_tables(db: sqlite3.Connection) -> list[str]:
    return [
        r[0]
        for r in db.execute("SELECT table_name FROM gpkg_contents WHERE data_type = 'features'")
    ]


def strip_header(blob: bytes) -> memoryview:
    """The WKB inside a GeoPackage geometry blob."""
    if blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry blob")
    flags = blob[3]
    envelope = ENVELOPE_BYTES.get((flags >> 1) & 0x07)
    if envelope is None:
        raise ValueError(f"unknown envelope indicator in flags {flags:08b}")
    return memoryview(blob)[8 + envelope :]


def parse_wkb_polygons(wkb: memoryview) -> list[list[np.ndarray]]:
    """[polygon][ring] -> (n, 2) float64 array of x/y in the file's CRS.

    Ring 0 of a polygon is its outer ring, the rest are holes."""
    polygons: list[list[np.ndarray]] = []
    offset = 0

    def read_polygon(off: int) -> tuple[list[np.ndarray], int]:
        (order, kind) = struct.unpack_from("<BI" if wkb[off] == 1 else ">BI", wkb, off)
        endian = "<" if order == 1 else ">"
        if kind != WKB_POLYGON:
            raise ValueError(f"expected a polygon inside, got WKB type {kind}")
        off += 5
        (n_rings,) = struct.unpack_from(f"{endian}I", wkb, off)
        off += 4
        rings: list[np.ndarray] = []
        for _ in range(n_rings):
            (n_points,) = struct.unpack_from(f"{endian}I", wkb, off)
            off += 4
            dtype = np.dtype("<f8" if endian == "<" else ">f8")
            ring = np.frombuffer(wkb, dtype=dtype, count=n_points * 2, offset=off)
            rings.append(ring.reshape(n_points, 2).astype("float64", copy=False))
            off += n_points * 16
        return rings, off

    (order, kind) = struct.unpack_from("<BI" if wkb[0] == 1 else ">BI", wkb, 0)
    endian = "<" if order == 1 else ">"
    if kind == WKB_POLYGON:
        rings, _ = read_polygon(0)
        return [rings]
    if kind != WKB_MULTIPOLYGON:
        raise ValueError(f"unsupported WKB type {kind}: only polygons are read")
    (n_polygons,) = struct.unpack_from(f"{endian}I", wkb, 5)
    offset = 9
    for _ in range(n_polygons):
        rings, offset = read_polygon(offset)
        polygons.append(rings)
    return polygons


def read_features(
    path: Path,
    table: str,
    attribute: str,
    limit: int | None = None,
    where: str | None = None,
) -> Iterator[tuple[str, list[list[np.ndarray]]]]:
    """(attribute value, [polygon][ring]) for every feature in the table."""
    db = connect(path)
    try:
        geom, _ = geometry_column(db, table)
        sql = f'SELECT "{attribute}", "{geom}" FROM "{table}"'
        if where:
            sql += f" WHERE {where}"
        if limit:
            sql += f" LIMIT {int(limit)}"
        for value, blob in db.execute(sql):
            if blob is None:
                continue
            yield str(value), parse_wkb_polygons(strip_header(bytes(blob)))
    finally:
        db.close()
