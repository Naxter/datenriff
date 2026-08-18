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
