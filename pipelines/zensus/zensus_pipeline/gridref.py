"""INSPIRE grid ids of the Zensus grids (ETRS89-LAEA, EPSG:3035).

Cells are identified by an id like ``CRS3035RES100mN2691700E4341100``
(lower-left corner in metres) or by explicit centre columns
(``x_mp_100m``/``y_mp_100m``); both appear across releases.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_GRID_ID_RE = re.compile(r"^CRS3035RES(\d+)mN(\d+)E(\d+)$")


@dataclass(frozen=True)
class GridCell:
    """One grid cell in EPSG:3035."""

    resolution_m: int
    """Cell edge length in metres (100, 1000, 10000)."""
    north: int
    """Northing of the lower-left corner, metres."""
    east: int
    """Easting of the lower-left corner, metres."""

    @property
    def centroid(self) -> tuple[float, float]:
        """(x=east, y=north) of the cell centre in EPSG:3035 metres."""
        half = self.resolution_m / 2
        return (self.east + half, self.north + half)


def parse_grid_id(grid_id: str) -> GridCell:
    """Parse an INSPIRE grid id such as ``CRS3035RES100mN2691700E4341100``."""
    m = _GRID_ID_RE.match(grid_id.strip())
    if not m:
        raise ValueError(f"Not a CRS3035 grid id: {grid_id!r}")
    res, north, east = (int(g) for g in m.groups())
    return GridCell(resolution_m=res, north=north, east=east)


def find_grid_id_column(fieldnames: list[str]) -> str | None:
    """Locate the grid-id column across release variants (case-insensitive)."""
    for name in fieldnames:
        if "gitter_id" in name.lower():
            return name
    return None


def find_centre_columns(fieldnames: list[str]) -> tuple[str, str] | None:
    """Locate explicit centre-coordinate columns (x_mp_*, y_mp_*)."""
    x = next((n for n in fieldnames if n.lower().startswith("x_mp")), None)
    y = next((n for n in fieldnames if n.lower().startswith("y_mp")), None)
    return (x, y) if x and y else None
