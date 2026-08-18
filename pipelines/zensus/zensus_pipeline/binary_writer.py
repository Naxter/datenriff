"""Binary buffer + manifest writing.

Buffers are explicitly little-endian so the browser can view them as typed
arrays without a decode step. Missing values: NaN in f32 buffers, 255 in u8.
"""

from __future__ import annotations

import json
import math
import struct
from collections.abc import Sequence
from pathlib import Path

U8_MISSING = 255


def write_f32(path: Path, values: Sequence[float | None]) -> None:
    data = struct.pack(
        f"<{len(values)}f",
        *((float("nan") if v is None else float(v)) for v in values),
    )
    path.write_bytes(data)


def read_f32(path: Path) -> list[float]:
    data = path.read_bytes()
    return list(struct.unpack(f"<{len(data) // 4}f", data))


def write_u8(path: Path, values: Sequence[int | None]) -> None:
    payload = bytes(U8_MISSING if v is None else int(v) for v in values)
    path.write_bytes(payload)


def write_positions(path: Path, lonlat: Sequence[tuple[float, float]]) -> None:
    """Interleaved [lon, lat] float32 pairs."""
    flat: list[float] = []
    for lon, lat in lonlat:
        flat.append(lon)
        flat.append(lat)
    path.write_bytes(struct.pack(f"<{len(flat)}f", *flat))


def compute_stats(
    values: Sequence[float | None], with_sum: bool = False
) -> dict[str, float]:
    """Robust distribution stats; missing values excluded."""
    finite = sorted(
        v for v in values if v is not None and not math.isnan(v)
    )
    if not finite:
        stats: dict[str, float] = {"min": 0, "max": 0, "p50": 0, "p95": 0, "p995": 0}
        if with_sum:
            stats["sum"] = 0
        return stats

    def q(p: float) -> float:
        return finite[min(len(finite) - 1, int(p * len(finite)))]

    stats = {
        "min": round(finite[0], 4),
        "max": round(finite[-1], 4),
        "p50": round(q(0.5), 4),
        "p95": round(q(0.95), 4),
        "p995": round(q(0.995), 4),
    }
    if with_sum:
        stats["sum"] = round(sum(finite), 4)
    return stats


def bounds_of(lonlat: Sequence[tuple[float, float]]) -> list[float]:
    """[west, south, east, north], rounded for the manifest."""
    lons = [p[0] for p in lonlat]
    lats = [p[1] for p in lonlat]
    return [
        round(min(lons), 3),
        round(min(lats), 3),
        round(max(lons), 3),
        round(max(lats), 3),
    ]


def merge_dataset_manifest(path: Path, fragment: dict) -> dict:
    """Merge a run's dataset fragment into an existing dataset manifest.

    Successive runs add metrics for the same cell universe; metrics with the
    same id are replaced, LOD entries are merged by resolution.
    """
    if path.exists():
        manifest = json.loads(path.read_text(encoding="utf-8"))
    else:
        manifest = {"metrics": [], "lods": []}

    manifest.update(
        {k: v for k, v in fragment.items() if k not in ("metrics", "lods")}
    )
    metrics = {m["id"]: m for m in manifest.get("metrics", [])}
    for m in fragment.get("metrics", []):
        metrics[m["id"]] = m
    manifest["metrics"] = list(metrics.values())

    lods = {l["resolution"]: l for l in manifest.get("lods", [])}
    for l in fragment.get("lods", []):
        existing = lods.get(l["resolution"], {})
        # per-LOD metric stats accumulate across runs; a plain update would
        # leave only the last metric's stats on the LOD
        merged_stats = {**existing.get("metricStats", {}), **l.get("metricStats", {})}
        existing.update(l)
        if merged_stats:
            existing["metricStats"] = merged_stats
        lods[l["resolution"]] = existing
    manifest["lods"] = sorted(lods.values(), key=lambda l: -l["resolution"])

    # explicit utf-8: Windows would otherwise use the ANSI codepage
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest
