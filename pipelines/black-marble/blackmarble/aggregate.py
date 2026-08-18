"""Raster → H3 aggregation for night-light composites.

Radiance is an intensity, not a count: two neighbouring pixels of 30
nW/cm²/sr do not make 60. Cells therefore take the **mean** of the pixels
falling into them (plan §92), and the pixel count travels with it so
coarser levels can re-weight instead of averaging averages.

Kept free of raster and H3 dependencies so it is testable with the
standard library alone.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping


def accumulate_mean(
    samples: Iterable[tuple[str, float | None]],
) -> tuple[dict[str, float], dict[str, int]]:
    """Mean value per cell. Returns (mean_by_cell, sample_count_by_cell)."""
    total: dict[str, float] = {}
    count: dict[str, int] = {}
    for cell, value in samples:
        if value is None:
            continue
        total[cell] = total.get(cell, 0.0) + value
        count[cell] = count.get(cell, 0) + 1
    return {cell: total[cell] / count[cell] for cell in count}, count


def aggregate_mean_to_parent(
    means: Mapping[str, float | None],
    counts: Mapping[str, int],
    parent_of: Callable[[str], str],
) -> tuple[dict[str, float | None], dict[str, int]]:
    """Aggregate a mean one level up, weighted by each child's sample count."""
    num: dict[str, float] = {}
    den: dict[str, int] = {}
    for cell, mean in means.items():
        if mean is None:
            continue
        weight = counts.get(cell, 0)
        if weight <= 0:
            continue
        parent = parent_of(cell)
        num[parent] = num.get(parent, 0.0) + mean * weight
        den[parent] = den.get(parent, 0) + weight
    return {parent: num[parent] / den[parent] for parent in den}, den


def relative_change(
    current: Mapping[str, float | None],
    previous: Mapping[str, float | None],
    min_baseline: float = 0.5,
) -> dict[str, float | None]:
    """Δ radiance against a baseline year. Dark cells have a meaningless
    denominator, so anything below `min_baseline` (nW/cm²/sr) is suppressed."""
    out: dict[str, float | None] = {}
    for cell, now in current.items():
        before = previous.get(cell)
        if now is None or before is None or before < min_baseline:
            out[cell] = None
        else:
            out[cell] = (now - before) / before
    return out
