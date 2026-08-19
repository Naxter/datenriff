"""Destatis special values.

Two kinds of marker share one look, and telling them apart matters.
The dash means the count really is zero — the census legend spells it out:
"– = Genau Null oder auf Null geändert". The others (``.``, ``/``, ``x``)
mean the number is unknown or withheld, and those must stay missing.

Reading a nil dash as missing quietly deletes the cell from a share: it
drops out of the denominator as well as the numerator, so the ratio is
pooled only over the cells that had something to report. On the 2022 grid
that is 88-90 % of cells, which turned a 5 % national share into a map
whose median cell read 39 %.

Values use German decimal commas.
"""

from __future__ import annotations

# "Nichts vorhanden" — exactly zero, or rounded to zero by the disclosure
# procedure. Destatis prints this as an en dash; a plain hyphen carries the
# same meaning in older publications.
NIL_TOKENS = frozenset({"-", "–", "—"})

# Unknown, withheld, or not applicable: no value, and none may be invented.
MISSING_TOKENS = frozenset({"", ".", "..", "...", "…", "/", "x", "X", "k.A.", "k. A."})


def parse_value(
    raw: str | None, extra_missing: frozenset[str] | None = None
) -> float | None:
    """Parse one CSV cell into a float, or None for missing/suppressed.

    Nil markers parse to 0.0; only unknown/withheld values are None.
    ``extra_missing`` covers release-specific markers, e.g. the 2011 grid
    uses ``-1`` for uninhabited or suppressed cells, and wins over both
    tables so a release can redefine a token.
    """
    if raw is None:
        return None
    text = raw.strip()
    if extra_missing and text in extra_missing:
        return None
    if text in NIL_TOKENS:
        return 0.0
    if text in MISSING_TOKENS:
        return None
    # German decimal comma; grid CSVs do not use thousands separators.
    text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None
