"""Polygons -> H3 coverage -> class area per cell.

The area of a polygon inside an output cell is measured by counting the
fine cells (r10, ~0.015 km2) whose centre falls in it. CLC5's smallest
mapping unit is 5 ha, roughly 33 r10 cells, so nothing in the source is
too small to be seen at that resolution — and an r8 output cell holds 49
of them, which is a 2 % step in the share it reports.

Counts, not areas in m2: every r10 cell covers the same area to within a
fraction of a percent at this latitude, so a count is an area in units of
"r10 cells" and the shares come out identical.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Iterator

import h3
import numpy as np
from pyproj import Transformer

#: resolution the areas are counted at, below every output LOD
FINE_RES = 10


def transformer(source_crs: str) -> Transformer:
    """Vertices come in the file's projected CRS; H3 needs lon/lat."""
    return Transformer.from_crs(source_crs, "EPSG:4326", always_xy=True)


def rings_to_latlng(rings: Iterable[np.ndarray], tr: Transformer) -> list[list[tuple[float, float]]]:
    """Projected rings -> [(lat, lng), ...] rings, which is what h3 wants."""
    out: list[list[tuple[float, float]]] = []
    for ring in rings:
        lon, lat = tr.transform(ring[:, 0], ring[:, 1])
        out.append(list(zip(lat.tolist(), lon.tolist())))
    return out


def polygon_cells(latlng_rings: list[list[tuple[float, float]]], res: int = FINE_RES) -> set[str]:
    """Fine cells whose centre lies inside the polygon (holes excluded)."""
    if not latlng_rings or len(latlng_rings[0]) < 4:
        return set()
    shape = h3.LatLngPoly(latlng_rings[0], *latlng_rings[1:])
    return set(h3.h3shape_to_cells(shape, res))


def accumulate(
    features: Iterator[tuple[str, list[list[np.ndarray]]]],
    group_of: dict[str, int],
    source_crs: str,
    out_res: int,
    n_groups: int,
    progress_every: int = 25_000,
    log=None,
) -> tuple[dict[str, np.ndarray], int]:
    """{output cell: counts per group} plus the number of fine cells seen.

    Features stream in one at a time; only the per-output-cell counters are
    kept, so memory stays with the output LOD (~half a million cells), not
    with the ~24 million fine cells the country covers.
    """
    tr = transformer(source_crs)
    counts: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(n_groups, dtype="int32"))
    parent_of = h3.cell_to_parent
    total_fine = 0
    seen = 0
    for code, polygons in features:
        seen += 1
        group = group_of.get(code.strip(), -1)
        if group < 0:
            continue
        for rings in polygons:
            fine = polygon_cells(rings_to_latlng(rings, tr))
            total_fine += len(fine)
            for cell in fine:
                counts[parent_of(cell, out_res)][group] += 1
        if log and seen % progress_every == 0:
            log(f"  {seen:,} features, {total_fine:,} fine cells, {len(counts):,} r{out_res} cells")
    return dict(counts), total_fine


def to_parent(counts: dict[str, np.ndarray], res: int) -> dict[str, np.ndarray]:
    """Pool counts to a coarser resolution; counts are areas, so they add."""
    pooled: dict[str, np.ndarray] = {}
    for cell, row in counts.items():
        parent = h3.cell_to_parent(cell, res)
        if parent in pooled:
            pooled[parent] += row
        else:
            pooled[parent] = row.copy()
    return pooled


def shares(row: np.ndarray, artificial_groups: Iterable[int]) -> tuple[float, int, float]:
    """(artificial share, dominant group, dominance) for one cell.

    Shares are fractions of 1, as everywhere else in the atlas — the app
    formats them as percentages."""
    total = int(row.sum())
    if total == 0:
        return float("nan"), -1, 0.0
    built = int(sum(int(row[g]) for g in artificial_groups))
    dominant = int(np.argmax(row))
    return built / total, dominant, float(row[dominant]) / total
