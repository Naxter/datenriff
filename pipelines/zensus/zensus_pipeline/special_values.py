"""Destatis special values.

Suppressed/unavailable cells are marked with tokens like ``–`` or ``.``.
They must become missing, never zero. Values use German decimal commas.
"""

from __future__ import annotations

# Tokens observed across Destatis publications for no data / suppressed /
# not applicable.
MISSING_TOKENS = frozenset(
    {"", "-", "–", "—", ".", "..", "...", "…", "/", "x", "X", "k.A.", "k. A."}
)


def parse_value(raw: str | None) -> float | None:
    """Parse one CSV cell into a float, or None for missing/suppressed."""
    if raw is None:
        return None
    text = raw.strip()
    if text in MISSING_TOKENS:
        return None
    # German decimal comma; grid CSVs do not use thousands separators.
    text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None
