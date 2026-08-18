"""Tiled writer for fine LODs.

Cells of a fine resolution are grouped by a coarser H3 parent and written
as one positions buffer plus one buffer per metric per tile, so the
viewer can fetch only what the viewport needs. ``index.json`` lists every
tile with its bounds and carries per-LOD metric stats — finer cells have
their own value distribution, and colour/height calibrate against it.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from pathlib import Path

from .binary_writer import bounds_of, write_f32, write_positions, write_u8

TILES_DIR = "tiles"


def group_by_tile(
    universe: Sequence[str],
    tile_of: Callable[[str], str],
) -> dict[str, list[int]]:
    """Universe indices per tile id, preserving universe order."""
    groups: dict[str, list[int]] = {}
    for idx, cell in enumerate(universe):
        groups.setdefault(tile_of(cell), []).append(idx)
    return groups


def write_tile_positions(
    res_dir: Path,
    groups: dict[str, list[int]],
    positions: Sequence[tuple[float, float]],
) -> dict[str, list[float]]:
    """Per-tile positions buffers; returns lon/lat bounds per tile."""
    tiles_dir = res_dir / TILES_DIR
    tiles_dir.mkdir(parents=True, exist_ok=True)
    bounds: dict[str, list[float]] = {}
    for tile_id, indices in groups.items():
        tile_positions = [positions[i] for i in indices]
        write_positions(tiles_dir / f"{tile_id}.positions.bin", tile_positions)
        bounds[tile_id] = list(bounds_of(tile_positions))
    return bounds


def write_tile_metric(
    res_dir: Path,
    groups: dict[str, list[int]],
    file_name: str,
    aligned: Sequence[float | None] | Sequence[int | None],
    storage: str,
) -> None:
    """Slice an aligned whole-LOD buffer into per-tile buffers."""
    tiles_dir = res_dir / TILES_DIR
    tiles_dir.mkdir(parents=True, exist_ok=True)
    writer = write_f32 if storage == "f32" else write_u8
    for tile_id, indices in groups.items():
        writer(tiles_dir / f"{tile_id}.{file_name}", [aligned[i] for i in indices])


def merge_tile_index(
    res_dir: Path,
    resolution: int,
    cell_radius_meters: float,
    tile_bounds: dict[str, list[float]] | None,
    tile_counts: dict[str, int],
    metric_stats: dict[str, dict],
) -> dict:
    """Create or update ``index.json``; successive metric runs merge in."""
    path = res_dir / "index.json"
    if path.exists():
        index = json.loads(path.read_text(encoding="utf-8"))
    else:
        index = {
            "resolution": resolution,
            "cellRadiusMeters": cell_radius_meters,
            "metrics": {},
            "tiles": [],
        }

    index["metrics"].update(metric_stats)

    if tile_bounds is not None:
        existing = {t["id"]: t for t in index.get("tiles", [])}
        for tile_id, bounds in tile_bounds.items():
            existing[tile_id] = {
                "id": tile_id,
                "count": tile_counts[tile_id],
                "bounds": bounds,
            }
        index["tiles"] = sorted(existing.values(), key=lambda t: t["id"])

    path.write_text(json.dumps(index, indent=1), encoding="utf-8")
    return index
