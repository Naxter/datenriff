"""NASA Black Marble VNP46A4 (annual, 500 m) tiles: download, read, sample.

VNP46A4 is the calibrated product: `AllAngle_Composite_Snow_Free` holds
annual nighttime radiance in nW/cm²/sr as float32, with a per-pixel
quality layer. Tiles are 10° × 10° on a plain lat/lon grid, 2400 × 2400
pixels (15 arc-seconds). Germany needs h18v03, h18v04, h19v03 and h19v04.

Access needs a free NASA Earthdata login. Create a token at
https://urs.earthdata.nasa.gov (Profile → Generate Token) and put it in
EARTHDATA_TOKEN — the environment or a .env file next to the repo root;
the pipeline downloads what is missing into --tiles-dir. Files fetched by
hand (wget with `--header "Authorization: Bearer $TOKEN"`) work as well —
the reader only needs them in that directory.

Granules are found through CMR (the Earthdata catalogue) and pulled from
the Earthdata Cloud bucket. The old LAADS archive path
(/archive/allData/5000/VNP46A4/<year>/001/) answers 404 today: collection
002 lives in archive set 5200 and is served from data.laadsdaac.
earthdatacloud.nasa.gov, which is what CMR hands out.
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
# CMR collection version; granule names carry it as `.002.`
VERSION = "2"
CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"

RADIANCE_LAYER = "AllAngle_Composite_Snow_Free"
QUALITY_LAYER = "AllAngle_Composite_Snow_Free_Quality"
GRID_PATH = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"

TILE_DEGREES = 10.0
TILE_PIXELS = 2400
PIXEL_DEGREES = TILE_DEGREES / TILE_PIXELS

DEFAULT_SCALE = 1.0
DEFAULT_FILL = -999.9
# quality of the composite: 0 good, 1 poor (few clear nights), 2 gap-filled
# from the record, 255 fill. Poor pixels carry the year's noise, not its
# light — drop them; gap-filled ones are still a considered estimate.
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


def bbox_of_tile(tile: str) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a tile, nudged inwards so a CMR bbox
    query does not also match the four neighbours along the edges."""
    west, north = tile_origin(tile)
    pad = 0.01
    return west + pad, north - TILE_DEGREES + pad, west + TILE_DEGREES - pad, north - pad


def tile_file(tiles_dir: Path, year: int, tile: str) -> Path | None:
    """The local file for a year/tile, whatever its production timestamp."""
    hits = sorted(tiles_dir.glob(f"{PRODUCT}.A{year}001.{tile}.*.h5"))
    return hits[-1] if hits else None


def _dotenv_token() -> str:
    """EARTHDATA_TOKEN from a .env file in this file's parents, if there."""
    for parent in Path(__file__).resolve().parents:
        env = parent / ".env"
        if not env.is_file():
            continue
        for line in env.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == "EARTHDATA_TOKEN":
                return value.strip().strip('"').strip("'")
    return ""


def _token() -> str:
    token = os.environ.get("EARTHDATA_TOKEN", "").strip() or _dotenv_token()
    if not token:
        raise SystemExit(
            "EARTHDATA_TOKEN is not set. Create a token at https://urs.earthdata.nasa.gov "
            "(Profile → Generate Token) and export it or put it in .env, or place the "
            ".h5 tiles in --tiles-dir yourself."
        )
    return token


def list_remote(year: int, bbox: tuple[float, float, float, float] | None = None) -> dict[str, str]:
    """{file name: download url} for a year, from the CMR granule catalogue.

    VNP46A4 is annual, so one granule per tile dated <year>-01-01. A bbox
    keeps the query to the tiles that touch it instead of all 540. The
    window also matches the previous year's granule, which ends on the same
    instant — callers pick by the A<year>001 in the name."""
    query = [
        f"short_name={PRODUCT}",
        f"version={VERSION}",
        f"temporal={year}-01-01T00:00:00Z,{year}-01-02T00:00:00Z",
        "page_size=100",
    ]
    if bbox:
        query.append("bounding_box=" + ",".join(str(v) for v in bbox))
    url = f"{CMR_GRANULES}?{'&'.join(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": "datenriff-blackmarble"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return granules_from_umm(json.loads(res.read().decode("utf-8")))


def granules_from_umm(payload: dict) -> dict[str, str]:
    """{file name: https url} from a CMR umm_json response. `GET DATA` is
    the https download; the s3:// twin needs in-region credentials."""
    found: dict[str, str] = {}
    for item in payload.get("items", []):
        for related in item.get("umm", {}).get("RelatedUrls", []):
            href = related.get("URL", "")
            if related.get("Type") == "GET DATA" and href.endswith(".h5"):
                found[href.rsplit("/", 1)[-1]] = href
    return found


def download(year: int, tile: str, tiles_dir: Path, urls: dict[str, str] | None = None) -> Path:
    """Fetch one tile into tiles_dir unless it is already there."""
    existing = tile_file(tiles_dir, year, tile)
    if existing:
        return existing
    tiles_dir.mkdir(parents=True, exist_ok=True)
    if urls is None:
        urls = list_remote(year, bbox_of_tile(tile))
    # the catalogue window also returns the previous year's granule, whose
    # coverage ends on 1 January — match the year in the name, not the order
    prefix = f"{PRODUCT}.A{year}001.{tile}."
    names = sorted(n for n in urls if n.startswith(prefix))
    if not names:
        raise SystemExit(f"{PRODUCT} {year} {tile}: no granule in the CMR catalogue")
    name = names[-1]
    target = tiles_dir / name
    tmp = target.with_suffix(".part")
    print(f"  downloading {name} …", file=sys.stderr)
    req = urllib.request.Request(
        urls[name],
        headers={"Authorization": f"Bearer {_token()}", "User-Agent": "datenriff-blackmarble"},
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as res, tmp.open("wb") as fh:
            while True:
                chunk = res.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
    except urllib.error.HTTPError as e:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"{urls[name]}: HTTP {e.code} — is EARTHDATA_TOKEN valid?") from e
    tmp.replace(target)
    return target


def read_tile(path: Path):
    """(radiance float32 array with NaN for fill/masked, quality uint8 array,
    (west, north) origin). Applies scale factor and the quality mask."""
    import h5py
    import numpy as np

    def _scalar(attrs, key, default):
        # attributes come as 1-element arrays
        return float(np.ravel(attrs[key])[0]) if key in attrs else default

    with h5py.File(path, "r") as f:
        grid = f[GRID_PATH]
        rad_ds = grid[RADIANCE_LAYER]
        raw = rad_ds[()]
        scale = _scalar(rad_ds.attrs, "scale_factor", DEFAULT_SCALE)
        offset = _scalar(rad_ds.attrs, "offset", 0.0)
        fill = _scalar(rad_ds.attrs, "_FillValue", DEFAULT_FILL)
        quality = grid[QUALITY_LAYER][()] if QUALITY_LAYER in grid else None
    is_fill = np.isclose(raw, fill)
    radiance = raw.astype("float32") * scale + offset
    radiance[is_fill] = np.nan
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

    from .pipeline import mask_in_rings

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
    rows_idx, cols_idx = np.nonzero(ok)
    if rows_idx.size == 0:
        return
    lons = west0 + (c0 + cols_idx + 0.5) * PIXEL_DEGREES
    lats = north0 - (r0 + rows_idx + 0.5) * PIXEL_DEGREES
    keep = (lons >= west) & (lons <= east) & (lats >= south) & (lats <= north)
    if rings is not None:
        keep &= mask_in_rings(lons, lats, rings)
    values = block[rows_idx, cols_idx]
    for lon, lat, value in zip(lons[keep], lats[keep], values[keep]):
        yield float(lon), float(lat), float(value)


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
    urls: dict[str, str] | None = None
    for tile in tiles_for_bbox(bbox):
        path = tile_file(tiles_dir, year, tile)
        if path is None:
            if not fetch:
                raise SystemExit(f"{PRODUCT} {year} {tile} missing in {tiles_dir}")
            if urls is None:  # one catalogue query per year, not per tile
                urls = list_remote(year, bbox)
            path = download(year, tile, tiles_dir, urls)
        radiance, quality, origin = read_tile(path)
        yield from sample_tile(radiance, quality, origin, bbox, floor, keep_quality, rings)
