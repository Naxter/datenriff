"""Aggregation rules, by metric semantics:

    counts     -> SUM
    averages   -> SUM(value*weight) / SUM(weight)
    shares     -> SUM(numerator) / SUM(denominator)
    categories -> per-category SUM, then argmax + dominance

``None`` means missing: skipped in aggregates, empty aggregates yield None.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping


def sum_values(values: Iterable[float | None]) -> float | None:
    """SUM for counts. None entries are skipped; all-missing → None."""
    total = 0.0
    seen = False
    for v in values:
        if v is not None:
            total += v
            seen = True
    return total if seen else None


def weighted_mean(pairs: Iterable[tuple[float | None, float | None]]) -> float | None:
    """SUM(value·weight)/SUM(weight); pairs with missing parts are skipped."""
    num = 0.0
    den = 0.0
    for value, weight in pairs:
        if value is None or weight is None or weight <= 0:
            continue
        num += value * weight
        den += weight
    return num / den if den > 0 else None


def share(
    pairs: Iterable[tuple[float | None, float | None]],
    min_denominator: float = 0.0,
) -> float | None:
    """SUM(numerator)/SUM(denominator); tiny denominators are suppressed."""
    num = 0.0
    den = 0.0
    for numerator, denominator in pairs:
        if numerator is None or denominator is None:
            continue
        num += numerator
        den += denominator
    if den <= 0 or den < min_denominator:
        return None
    return num / den


def categorical_dominant(counts: Mapping[int, float]) -> tuple[int, float] | None:
    """(dominant category, dominance = max/total) from per-category counts."""
    total = sum(c for c in counts.values() if c > 0)
    if total <= 0:
        return None
    category = max(counts, key=lambda k: (counts[k], -k))
    return category, counts[category] / total


def change_pct(
    current: float | None,
    previous: float | None,
    min_denominator: float = 25.0,
) -> float | None:
    """Relative change with small-denominator suppression."""
    if current is None or previous is None or previous < min_denominator:
        return None
    return (current - previous) / previous


def aggregate_sum_to_parent(
    cells: Mapping[str, float | None],
    parent_of: Callable[[str], str],
) -> dict[str, float | None]:
    """Aggregate a SUM metric one level up; child None values are skipped."""
    grouped: dict[str, list[float | None]] = defaultdict(list)
    for cell, value in cells.items():
        grouped[parent_of(cell)].append(value)
    return {parent: sum_values(vs) for parent, vs in grouped.items()}


def aggregate_weighted_mean_to_parent(
    values: Mapping[str, float | None],
    weights: Mapping[str, float | None],
    parent_of: Callable[[str], str],
) -> dict[str, float | None]:
    """Aggregate an average metric one level up using its weight metric."""
    grouped: dict[str, list[tuple[float | None, float | None]]] = defaultdict(list)
    for cell, value in values.items():
        grouped[parent_of(cell)].append((value, weights.get(cell)))
    return {parent: weighted_mean(pairs) for parent, pairs in grouped.items()}


def accumulate_mean(
    samples: Iterable[tuple[str, float | None]],
) -> tuple[dict[str, float], dict[str, int]]:
    """Mean value per cell for intensity samples (radiance, precipitation:
    two pixels of 30 do not make 60). Returns (mean_by_cell,
    sample_count_by_cell) — the count travels with the mean so coarser
    levels can re-weight instead of averaging averages."""
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


def weighted_harmonic_mean(
    pairs: Iterable[tuple[float | None, float | None]],
) -> float | None:
    """SUM(w) / SUM(w/v) — the pooled value of a per-unit average.

    Household size is persons per home. Averaging it arithmetically over
    cells answers "the average of the averages"; what is wanted is total
    persons over total homes, and the homes of a cell are w/v. The two
    differ by about 7 % nationally, always upwards, because a big household
    contributes more persons and therefore more weight.
    """
    weight = 0.0
    units = 0.0
    for value, w in pairs:
        if value is None or w is None or w <= 0 or value <= 0:
            continue
        weight += w
        units += w / value
    if units <= 0:
        return None
    return weight / units


def aggregate_harmonic_mean_to_parent(
    values: Mapping[str, float | None],
    weights: Mapping[str, float | None],
    parent_of: Callable[[str], str],
) -> dict[str, float | None]:
    """Aggregate a per-unit average one level up, pooling the implied units."""
    grouped: dict[str, list[tuple[float | None, float | None]]] = defaultdict(list)
    for cell, value in values.items():
        grouped[parent_of(cell)].append((value, weights.get(cell)))
    return {parent: weighted_harmonic_mean(pairs) for parent, pairs in grouped.items()}


def aggregate_share_to_parent(
    numerators: Mapping[str, float | None],
    denominators: Mapping[str, float | None],
    parent_of: Callable[[str], str],
    min_denominator: float = 0.0,
) -> dict[str, float | None]:
    """Aggregate a share one level up by pooling numerators and denominators."""
    grouped: dict[str, list[tuple[float | None, float | None]]] = defaultdict(list)
    for cell, numerator in numerators.items():
        grouped[parent_of(cell)].append((numerator, denominators.get(cell)))
    return {
        parent: share(pairs, min_denominator) for parent, pairs in grouped.items()
    }


def aggregate_categories_to_parent(
    category_counts: Mapping[str, Mapping[int, float]],
    parent_of: Callable[[str], str],
) -> dict[str, tuple[int, float] | None]:
    """Aggregate per-cell category counts one level up, then argmax."""
    grouped: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for cell, counts in category_counts.items():
        target = grouped[parent_of(cell)]
        for category, count in counts.items():
            target[category] += count
    return {parent: categorical_dominant(counts) for parent, counts in grouped.items()}
