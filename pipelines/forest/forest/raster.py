"""Read the disturbance atlas rasters and reduce them to counted blocks.

The atlas ships 30 m GeoTIFFs in EPSG:3035, one set per country. Germany is
roughly 600 million pixels, far too many to hand to H3 one at a time, so the
rasters are reduced in blocks first: each block carries how many of its
pixels are forest, how many of those were ever disturbed, and how the
disturbances split by cause. Counts survive pooling — a share does not — so
everything downstream adds them up and divides at the very end.

Three layers are read, all on the same grid:

    forest_mask_<country>.tif        1 where forest, 0 elsewhere
    latest_disturbance_<country>.tif year of the most recent disturbance
    disturbance_agent_aggregated_    1 wind/bark beetle, 2 fire,
        <country>.tif                3 harvest, 4 mixed
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterator, NamedTuple

import numpy as np

#: Agent codes of the atlas, in the order their counts are stored.
AGENT_CODES = (1, 2, 3, 4)
AGENT_LABELS = ("Wind & bark beetle", "Fire", "Harvest", "Mixed")

#: 30 m pixels. Two of them per block is ~60 m, comfortably finer than an
#: H3 r10 cell (~116 m across) without making the H3 pass the bottleneck.
DEFAULT_BLOCK = 2


class Chunk(NamedTuple):
    """One horizontal strip of blocks, already filtered to blocks with forest."""

    xs: np.ndarray
    """Block centre easting in the raster CRS."""
    ys: np.ndarray
    """Block centre northing in the raster CRS."""
    forest: np.ndarray
    """Forest pixels per block."""
    disturbed: np.ndarray
    """Forest pixels disturbed at least once, per block."""
    agents: np.ndarray
    """Per block, one column per entry in AGENT_CODES."""


def _block_sum(flags: np.ndarray, block: int) -> np.ndarray:
    """Sum a boolean array over block x block tiles."""
    rows, cols = flags.shape
    trimmed = flags[: rows - rows % block, : cols - cols % block]
    reshaped = trimmed.reshape(trimmed.shape[0] // block, block, trimmed.shape[1] // block, block)
    return reshaped.sum(axis=(1, 3), dtype="int32")


def open_set(directory: Path, country: str):
    """The three raster paths for one country, checked for existence."""
    names = {
        "mask": f"forest_mask_{country}.tif",
        "latest": f"latest_disturbance_{country}.tif",
        "agent": f"disturbance_agent_aggregated_{country}.tif",
    }
    paths = {key: directory / name for key, name in names.items()}
    missing = [str(p) for p in paths.values() if not p.exists()]
    if missing:
        raise SystemExit("missing raster(s): " + ", ".join(missing))
    return paths


def read_blocks(
    paths: dict[str, Path],
    block: int = DEFAULT_BLOCK,
    chunk_rows: int = 2048,
    log: Callable[[str], None] = lambda _m: None,
) -> Iterator[Chunk]:
    """Stream the rasters strip by strip, yielding blocks that hold forest."""
    import rasterio
    from rasterio.windows import Window

    with (
        rasterio.open(paths["mask"]) as mask_ds,
        rasterio.open(paths["latest"]) as latest_ds,
        rasterio.open(paths["agent"]) as agent_ds,
    ):
        for name, ds in (("latest", latest_ds), ("agent", agent_ds)):
            if (ds.width, ds.height) != (mask_ds.width, mask_ds.height):
                raise SystemExit(f"{name} raster is not on the mask's grid")
        transform = mask_ds.transform
        log(f"  {mask_ds.width} x {mask_ds.height} px, {mask_ds.crs}, block {block} px")

        # blocks must not straddle strips, or a block is counted twice
        step = max(block, (chunk_rows // block) * block)
        for row0 in range(0, mask_ds.height, step):
            rows = min(step, mask_ds.height - row0)
            if rows < block:
                break
            window = Window(0, row0, mask_ds.width, rows)
            mask = mask_ds.read(1, window=window)
            is_forest = mask == 1
            if not is_forest.any():
                continue
            latest = latest_ds.read(1, window=window)
            agent = agent_ds.read(1, window=window)

            forest = _block_sum(is_forest, block)
            was_disturbed = is_forest & (latest > 0)
            disturbed = _block_sum(was_disturbed, block)
            agents = np.stack(
                [_block_sum(was_disturbed & (agent == code), block) for code in AGENT_CODES],
                axis=-1,
            )

            keep = forest > 0
            if not keep.any():
                continue
            block_rows, block_cols = np.nonzero(keep)
            # centre of the block, in the raster's own coordinates
            xs = transform.c + transform.a * (block_cols * block + block / 2)
            ys = transform.f + transform.e * ((row0 + block_rows * block) + block / 2)
            yield Chunk(
                xs=xs,
                ys=ys,
                forest=forest[keep],
                disturbed=disturbed[keep],
                agents=agents[keep],
            )


def to_lonlat(xs: np.ndarray, ys: np.ndarray, source_crs: str):
    """Project block centres to WGS84, which is what H3 speaks."""
    from pyproj import Transformer

    transformer = Transformer.from_crs(source_crs, "EPSG:4326", always_xy=True)
    return transformer.transform(xs, ys)
