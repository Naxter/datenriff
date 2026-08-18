"""Base-level (res-10) accumulation of streamed grid rows.

The H3 lookup is injected as a batch function, so everything here runs and
tests with the stdlib alone. Payloads are dicts of already-parsed values;
None means missing and never contributes.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator, Sequence


def batched_cells(
    rows: Iterable[tuple[float, float, dict]],
    cell_of_batch: Callable[[Sequence[float], Sequence[float]], Sequence[str]],
    batch_size: int = 100_000,
) -> Iterator[tuple[str, dict]]:
    """(x, y, payload) rows -> (cell, payload), transforming coordinates in
    batches (pyproj and h3 are far faster on arrays than on single points)."""
    xs: list[float] = []
    ys: list[float] = []
    payloads: list[dict] = []
    for x, y, payload in rows:
        xs.append(x)
        ys.append(y)
        payloads.append(payload)
        if len(xs) >= batch_size:
            for cell, p in zip(cell_of_batch(xs, ys), payloads):
                yield cell, p
            xs.clear()
            ys.clear()
            payloads.clear()
    if xs:
        for cell, p in zip(cell_of_batch(xs, ys), payloads):
            yield cell, p


def accumulate_sum(
    cell_payloads: Iterable[tuple[str, dict]],
    value_key: str,
) -> dict[str, float]:
    cells: dict[str, float] = defaultdict(float)
    for cell, payload in cell_payloads:
        value = payload.get(value_key)
        if value is not None:
            cells[cell] += value
    return dict(cells)


def accumulate_weighted(
    cell_payloads: Iterable[tuple[str, dict]],
    value_key: str,
    weight_key: str,
) -> tuple[dict[str, float], dict[str, float]]:
    """Weighted mean per cell. Returns (mean_by_cell, weight_by_cell); the
    weights are kept so coarser levels can re-weight correctly."""
    num: dict[str, float] = defaultdict(float)
    den: dict[str, float] = defaultdict(float)
    for cell, payload in cell_payloads:
        value = payload.get(value_key)
        weight = payload.get(weight_key)
        if value is None or weight is None or weight <= 0:
            continue
        num[cell] += value * weight
        den[cell] += weight
    means = {cell: num[cell] / den[cell] for cell in den}
    return means, dict(den)


def accumulate_share(
    cell_payloads: Iterable[tuple[str, dict]],
    numerator_key: str,
    denominator_key: str,
) -> tuple[dict[str, float], dict[str, float]]:
    """Share per cell. Returns (numerator_by_cell, denominator_by_cell); both
    are kept so coarser levels pool the parts instead of averaging ratios."""
    num: dict[str, float] = defaultdict(float)
    den: dict[str, float] = defaultdict(float)
    for cell, payload in cell_payloads:
        numerator = payload.get(numerator_key)
        denominator = payload.get(denominator_key)
        if numerator is None or denominator is None:
            continue
        num[cell] += numerator
        den[cell] += denominator
    return dict(num), dict(den)


def accumulate_categories(
    cell_payloads: Iterable[tuple[str, dict]],
    category_keys: Sequence[str],
) -> dict[str, dict[int, float]]:
    """Per-cell counts per category index (index = position in category_keys)."""
    cells: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for cell, payload in cell_payloads:
        counts = cells[cell]
        for idx, key in enumerate(category_keys):
            count = payload.get(key)
            if count is not None and count > 0:
                counts[idx] += count
    return {cell: dict(counts) for cell, counts in cells.items() if counts}
