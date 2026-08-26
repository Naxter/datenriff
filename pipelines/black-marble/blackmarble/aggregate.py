"""Raster → H3 aggregation for night-light composites.

Radiance is an intensity, not a count: two neighbouring pixels of 30
nW/cm²/sr do not make 60. Cells therefore take the **mean** of the pixels
falling into them, and the pixel count travels with it so
coarser levels can re-weight instead of averaging averages.

Kept free of raster and H3 dependencies so it is testable with the
standard library alone. The mean helpers moved to zensus_pipeline.aggregate
— dwd pools intensities the same way — and are re-exported here.
"""

from __future__ import annotations

from collections.abc import Mapping

from zensus_pipeline.aggregate import (  # noqa: F401  (re-export)
    accumulate_mean,
    aggregate_mean_to_parent,
)


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
