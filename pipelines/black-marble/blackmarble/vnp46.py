"""NASA Black Marble VNP46A4 (annual, 500 m) tiles: download, read, sample.

VNP46A4 is the calibrated product: `AllAngle_Composite_Snow_Free` holds
annual median nighttime radiance in nW/cm²/sr (stored as uint16 × 0.1),
with a per-pixel quality layer. Tiles are 10° × 10° on a plain lat/lon
grid, 2400 × 2400 pixels (15 arc-seconds). Germany needs h18v03, h18v04,
h19v03 and h19v04.

Access needs a free NASA Earthdata login. Create a token at
https://urs.earthdata.nasa.gov (Profile → Generate Token) and export it as
EARTHDATA_TOKEN; the pipeline downloads what is missing into --tiles-dir.
Files fetched by hand (wget with `--header "Authorization: Bearer $TOKEN"`)
work as well — the reader only needs them in that directory.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

PRODUCT = "VNP46A4"
COLLECTION = "5000"
LAADS_ARCHIVE = f"https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/{COLLECTION}/{PRODUCT}"

RADIANCE_LAYER = "AllAngle_Composite_Snow_Free"
QUALITY_LAYER = "AllAngle_Composite_Snow_Free_Quality"
GRID_PATH = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"

TILE_DEGREES = 10.0
TILE_PIXELS = 2400
PIXEL_DEGREES = TILE_DEGREES / TILE_PIXELS

DEFAULT_SCALE = 0.1
DEFAULT_FILL = 65535
# quality: 0 persistent lights, 1 ephemeral (fires, boats), 2 gap-filled from
# history, 255 fill. Ephemeral lights are not settlement — drop them.
DEFAULT_KEEP_QUALITY = (0, 2)

GERMANY_TILES = ("h18v03", "h18v04", "h19v03", "h19v04")


def tiles_for_bbox(bbox: tuple[float, float, float, float]) -> list[str]:
    """Tile ids (hHHvVV) intersecting a lon/lat bbox."""
    west, south, east, north = bbox
    tiles = []
    for h in range(int((west + 180) // TILE_DEGREES), int((east + 180) // TILE_DEGREES) + 1):
        for v in range(int((90 - north) // TILE_DEGREES), int((90 - south) // TILE_DEGREES) + 1):
            tiles.append(f"h{h:02d}v{v:02d}")
    return tiles


def tile_origin(tile: str) -> tuple[float, float]:
    """(west lon, north lat) of a tile's upper-left corner."""
    m = re.fullmatch(r"h(\d{2})v(\d{2})", tile)
    if not m:
        raise ValueError(f"not a tile id: {tile}")
    h, v = int(m.group(1)), int(m.group(2))
    return -180.0 + h * TILE_DEGREES, 90.0 - v * TILE_DEGREES


def tile_file(tiles_dir: Path, year: int, tile: str) -> Path | None:
    """The local file for a year/tile, whatever its production timestamp."""
    hits = sorted(tiles_dir.glob(f"{PRODUCT}.A{year}001.{tile}.*.h5"))
    return hits[-1] if hits else None


def _token() -> str:
    token = os.environ.get("EARTHDATA_TOKEN", "").strip()
    if not token:
        raise SystemExit(
            "EARTHDATA_TOKEN is not set. Create a token at https://urs.earthdata.nasa.gov "
            "(Profile → Generate Token) and export it, or place the .h5 tiles in "
            "--tiles-dir yourself."
        )
    return token


def list_remote(year: int) -> list[str]:
    """File names available for a year (LAADS directory listing as JSON)."""
    url = f"{LAADS_ARCHIVE}/{year}/001.json"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {_token()}"})
    with urllib.request.urlopen(req, timeout=60) as res:
        listing = json.loads(res.read().decode("utf-8"))
    names: list[str] = []
    for entry in listing if isinstance(listing, list) else listing.get("content", []):
        name = entry.get("name") if isinstance(entry, dict) else None
        if name and name.endswith(".h5"):
            names.append(name)
    return names


def download(year: int, tile: str, tiles_dir: Path) -> Path:
    """Fetch one tile into tiles_dir unless it is already there."""
    existing = tile_file(tiles_dir, year, tile)
    if existing:
        return existing
    tiles_dir.mkdir(parents=True, exist_ok=True)
    names = [n for n in list_remote(year) if f".{tile}." in n]
    if not names:
        raise SystemExit(f"{PRODUCT} {year} {tile}: not in the LAADS listing")
    name = sorted(names)[-1]
    url = f"{LAADS_ARCHIVE}/{year}/001/{name}"
    target = tiles_dir / name
    tmp = target.with_suffix(".part")
    print(f"  downloading {name} …", file=sys.stderr)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {_token()}"})
    try:
        with urllib.request.urlopen(req, timeout=600) as res, tmp.open("wb") as fh:
            while True:
                chunk = res.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
    except urllib.error.HTTPError as e:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"{url}: HTTP {e.code} — is EARTHDATA_TOKEN valid?") from e
    tmp.replace(target)
    return target


def read_tile(path: Path):
    """(radiance float32 array with NaN for fill/masked, quality uint8 array,
    (west, north) origin). Applies scale factor and the quality mask."""
    import h5py
    import numpy as np

    with h5py.File(path, "r") as f:
        grid = f[GRID_PATH]
        rad_ds = grid[RADIANCE_LAYER]
        raw = rad_ds[()]
        scale = float(rad_ds.attrs.get("scale_factor", DEFAULT_SCALE))
        fill = int(rad_ds.attrs.get("_FillValue", DEFAULT_FILL))
        quality = grid[QUALITY_LAYER][()] if QUALITY_LAYER in grid else None
    radiance = raw.astype("float32") * scale
    radiance[raw == fill] = np.nan
    tile = re.search(r"\.(h\d{2}v\d{2})\.", path.name)
    origin = tile_origin(tile.group(1)) if tile else (-180.0, 90.0)
    return radiance, quality, origin


def sample_tile(
    radiance,
    quality,
    origin: tuple[float, float],
    bbox: tuple[float, float, float, float],
    floor: float,
    keep_quality=DEFAULT_KEEP_QUALITY,
    rings=None,
) -> Iterator[tuple[float, float, float]]:
    """Yield (lon, lat, radiance) for pixel centres inside the bbox (and the
    clip rings, if given) that pass the quality mask and the floor."""
    import numpy as np

    from .pipeline import point_in_rings

    west0, north0 = origin
    west, south, east, north = bbox
    rows, cols = radiance.shape
    c0 = max(0, int((west - west0) / PIXEL_DEGREES))
    c1 = min(cols, int((east - west0) / PIXEL_DEGREES) + 1)
    r0 = max(0, int((north0 - north) / PIXEL_DEGREES))
    r1 = min(rows, int((north0 - south) / PIXEL_DEGREES) + 1)
    if c0 >= c1 or r0 >= r1:
        return
    block = radiance[r0:r1, c0:c1]
    ok = ~np.isnan(block) & (block > floor)
    if quality is not None:
        q = quality[r0:r1, c0:c1]
        ok &= np.isin(q, list(keep_quality))
    for r, c in zip(*np.nonzero(ok)):
        lon = west0 + (c0 + c + 0.5) * PIXEL_DEGREES
        lat = north0 - (r0 + r + 0.5) * PIXEL_DEGREES
        if lon < west or lon > east or lat < south or lat > north:
            continue
        if rings is not None and not point_in_rings(lon, lat, rings):
            continue
        yield lon, lat, float(block[r, c])


def sample_year(
    year: int,
    tiles_dir: Path,
    bbox: tuple[float, float, float, float],
    floor: float,
    keep_quality=DEFAULT_KEEP_QUALITY,
    rings=None,
    fetch: bool = True,
) -> Iterator[tuple[float, float, float]]:
    """All samples of one year over the bbox, tile by tile."""
    for tile in tiles_for_bbox(bbox):
        path = tile_file(tiles_dir, year, tile)
        if path is None:
            if not fetch:
                raise SystemExit(f"{PRODUCT} {year} {tile} missing in {tiles_dir}")
            path = download(year, tile, tiles_dir)
        radiance, quality, origin = read_tile(path)
        yield from sample_tile(radiance, quality, origin, bbox, floor, keep_quality, rings)
