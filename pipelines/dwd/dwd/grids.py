"""DWD gridded climate data (opendata.dwd.de) — download, read, reproject.

The CDC grids are ESRI ASCII rasters, 1 km, already clipped to Germany
(everything outside is NODATA), in DHDN / Gauss-Krüger zone 3
(EPSG:31467). Annual precipitation exists from 1881 on, one file per year:

    grids_germany/annual/precipitation/grids_germany_annual_precipitation_<year>17.asc.gz

The trailing 17 is DWD's period code for the calendar year. Monthly grids
live one level up under `monthly/precipitation/<MM>/` with the month as
the code — same reader, so `--period` covers both.

No login, no token: the CDC is open data (DWD, "Datenlizenz Deutschland –
Namensnennung – Version 2.0", source must be named).
"""

from __future__ import annotations

import gzip
import ssl
import sys
import urllib.error
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

CDC = "https://opendata.dwd.de/climate_environment/CDC/grids_germany"
GRID_CRS = "EPSG:31467"
WGS84 = "EPSG:4326"
#: calendar-year code in the annual file names
ANNUAL_PERIOD = "17"


@dataclass
class GridHeader:
    ncols: int
    nrows: int
    xllcorner: float
    yllcorner: float
    cellsize: float
    nodata: float


def annual_url(variable: str, year: int, period: str = ANNUAL_PERIOD) -> str:
    return (
        f"{CDC}/annual/{variable}/grids_germany_annual_{variable}_{year}{period}.asc.gz"
    )


def local_path(cache: Path, variable: str, year: int, period: str = ANNUAL_PERIOD) -> Path:
    return cache / f"grids_germany_annual_{variable}_{year}{period}.asc.gz"


def download(variable: str, year: int, cache: Path, period: str = ANNUAL_PERIOD) -> Path:
    """Fetch one yearly grid into the cache unless it is already there."""
    target = local_path(cache, variable, year, period)
    if target.exists() and target.stat().st_size > 0:
        return target
    cache.mkdir(parents=True, exist_ok=True)
    url = annual_url(variable, year, period)
    tmp = target.with_suffix(".part")
    print(f"  downloading {target.name} ...", file=sys.stderr)
    try:
        with urllib.request.urlopen(url, timeout=300, context=ssl_context()) as res, tmp.open("wb") as fh:
            while True:
                chunk = res.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
    except urllib.error.HTTPError as e:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"{url}: HTTP {e.code}") from e
    tmp.replace(target)
    return target


def ssl_context() -> ssl.SSLContext | None:
    """DWD serves a chain whose root Windows only fetches on demand, so a
    plain urlopen fails there with CERTIFICATE_VERIFY_FAILED while curl
    succeeds. Use certifi's bundle when it is installed."""
    try:
        import certifi
    except ImportError:
        return None
    return ssl.create_default_context(cafile=certifi.where())


def read_header(handle) -> GridHeader:
    fields: dict[str, float] = {}
    for _ in range(6):
        key, value = handle.readline().split()
        fields[key.strip().lower()] = float(value)
    return GridHeader(
        ncols=int(fields["ncols"]),
        nrows=int(fields["nrows"]),
        xllcorner=fields["xllcorner"],
        yllcorner=fields["yllcorner"],
        cellsize=fields["cellsize"],
        nodata=fields["nodata_value"],
    )


def _open(path: Path):
    return gzip.open(path, "rt") if path.suffix == ".gz" else path.open("r")


def sample_grid(path: Path, scale: float = 1.0) -> Iterator[tuple[float, float, float]]:
    """Yield (lon, lat, value) for every cell that carries data.

    Rows are ESRI order (north first). Cell centres are reprojected one row
    at a time — 654 points per call instead of 566,000 single calls.
    """
    from pyproj import Transformer

    to_wgs84 = Transformer.from_crs(GRID_CRS, WGS84, always_xy=True)
    with _open(path) as fh:
        h = read_header(fh)
        for r in range(h.nrows):
            line = fh.readline()
            if not line:
                break
            raw = line.split()
            if len(raw) != h.ncols:
                raise SystemExit(f"{path.name}: row {r} has {len(raw)} values, expected {h.ncols}")
            keep = [(c, float(v)) for c, v in enumerate(raw) if float(v) != h.nodata]
            if not keep:
                continue
            y = h.yllcorner + (h.nrows - r - 0.5) * h.cellsize
            xs = [h.xllcorner + (c + 0.5) * h.cellsize for c, _ in keep]
            lons, lats = to_wgs84.transform(xs, [y] * len(xs))
            for (lon, lat), (_, value) in zip(zip(lons, lats), keep):
                yield lon, lat, value * scale
