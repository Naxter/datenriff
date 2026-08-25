"""Stream generation units out of a MaStR export XML.

The export lists one `<EinheitWind>` (etc.) element per unit with flat
child fields. Only what the atlas needs is kept, and only units the
register places on the map itself: no coordinates, no unit —
we never invent a position from a municipality.
"""

from __future__ import annotations

import datetime as _dt
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from dataclasses import dataclass

# EinheitBetriebsstatus codes
STATUS_IN_BETRIEB = 35
STATUS_IN_PLANUNG = 31
STATUS_VORUEBERGEHEND_STILLGELEGT = 37
STATUS_ENDGUELTIG_STILLGELEGT = 38
INSTALLED_STATUSES = {STATUS_IN_BETRIEB, STATUS_VORUEBERGEHEND_STILLGELEGT, STATUS_ENDGUELTIG_STILLGELEGT}

# Lage codes for wind
LAGE_ONSHORE = 888
LAGE_OFFSHORE = 889


@dataclass
class Unit:
    id: str
    lon: float
    lat: float
    # kW as registered (Bruttoleistung); MW downstream
    kw: float
    commissioned: _dt.date | None
    decommissioned: _dt.date | None
    status: int | None
    offshore: bool


def _date(text: str | None) -> _dt.date | None:
    if not text:
        return None
    try:
        return _dt.date.fromisoformat(text.strip()[:10])
    except ValueError:
        return None


def _float(text: str | None) -> float | None:
    if text is None:
        return None
    t = text.strip().replace(",", ".")
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _int(text: str | None) -> int | None:
    f = _float(text)
    return int(f) if f is not None else None


def parse_units(stream, element: str = "EinheitWind") -> Iterator[Unit]:
    """Yield units with public coordinates from an XML byte stream. Elements
    are cleared as they go, so a 100 MB file streams in constant memory."""
    for event, el in ET.iterparse(stream, events=("end",)):
        tag = el.tag.rsplit("}", 1)[-1]
        if tag != element:
            continue
        f = {child.tag.rsplit("}", 1)[-1]: child.text for child in el}
        el.clear()
        lon = _float(f.get("Laengengrad"))
        lat = _float(f.get("Breitengrad"))
        kw = _float(f.get("Bruttoleistung"))
        if lon is None or lat is None or kw is None:
            continue
        if not (-180 <= lon <= 180 and -90 <= lat <= 90) or (lon == 0 and lat == 0):
            continue
        yield Unit(
            id=f.get("EinheitMastrNummer") or "",
            lon=lon,
            lat=lat,
            kw=kw,
            commissioned=_date(f.get("Inbetriebnahmedatum")),
            decommissioned=_date(f.get("DatumEndgueltigeStilllegung")),
            status=_int(f.get("EinheitBetriebsstatus")),
            offshore=_int(f.get("Lage")) == LAGE_OFFSHORE,
        )


def installed_in_year(unit: Unit, year: int) -> bool:
    """Was the unit standing at the end of `year`? Planned units never
    count; a unit counts from its commissioning year until the year before
    its final shutdown."""
    if unit.status not in INSTALLED_STATUSES:
        return False
    if unit.commissioned is None or unit.commissioned.year > year:
        return False
    if unit.decommissioned is not None and unit.decommissioned.year <= year:
        return False
    return True
