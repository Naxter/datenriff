"""Year-spec parsing, shared by the year-series pipelines.

Black marble and dwd both take ``--years 2012-2015,2020`` and carried
identical parsers; a fix or a format extension had to be made twice.
"""

from __future__ import annotations


def parse_years(spec: str) -> list[int]:
    """'2012-2015,2020' -> [2012, 2013, 2014, 2015, 2020]."""
    years: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            years.update(range(int(a), int(b) + 1))
        else:
            years.add(int(part))
    if not years:
        raise SystemExit("no years given")
    return sorted(years)
