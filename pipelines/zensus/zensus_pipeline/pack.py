"""Pack a tiled LOD: one file per tile instead of one per tile and metric.

Successive metric runs write ``tiles/<tile>.<metric>.<storage>`` files; with
ten metrics that is eleven files per tile and ~19,000 for r9 — right at the
file-count limits of static hosts, and one request per metric on load. This
step folds every tile into ``tiles/<tile>.pack``:

    "DRTL" · u32 version (1) · u32 header length · header JSON (utf-8, padded
    to 4 bytes) · payload; header = {"count", "sections": [{"name", "dtype",
    "size", "offset", "length"}, ...]}, offsets relative to the payload start
    and 4-byte aligned, so the browser can view f32 sections in place.

Section names are ``positions`` and the metric ids. Loose files are removed,
``index.json`` gets ``packed: true`` and ``dataset.json``'s LOD entry a
``tilePackTemplate``. Run it again after adding metrics (they arrive loose
and get folded in; existing sections are kept).

    python -m zensus_pipeline.pack --lod ../../apps/web/public/data/zensus/r9
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

MAGIC = b"DRTL"
VERSION = 1
TILES_DIR = "tiles"


def _align(n: int) -> int:
    return (n + 3) & ~3


def encode_pack(count: int, sections: list[tuple[str, str, int, bytes]]) -> bytes:
    """sections: (name, dtype 'f32'|'u8', size per cell, raw little-endian bytes)."""
    table = []
    payload = bytearray()
    for name, dtype, size, data in sections:
        offset = _align(len(payload))
        payload.extend(b"\0" * (offset - len(payload)))
        table.append({"name": name, "dtype": dtype, "size": size, "offset": offset, "length": len(data)})
        payload.extend(data)
    header = json.dumps({"count": count, "sections": table}, separators=(",", ":")).encode("utf-8")
    header += b" " * (_align(len(header)) - len(header))
    return MAGIC + struct.pack("<II", VERSION, len(header)) + header + bytes(payload)


def decode_pack(blob: bytes) -> tuple[int, dict[str, tuple[str, int, bytes]]]:
    """Inverse of encode_pack: (count, {name: (dtype, size, bytes)})."""
    if blob[:4] != MAGIC:
        raise ValueError("not a tile pack")
    version, header_len = struct.unpack_from("<II", blob, 4)
    if version != VERSION:
        raise ValueError(f"unsupported pack version {version}")
    header = json.loads(blob[12:12 + header_len].decode("utf-8"))
    payload = blob[12 + header_len:]
    out = {}
    for s in header["sections"]:
        out[s["name"]] = (s["dtype"], s["size"], payload[s["offset"]:s["offset"] + s["length"]])
    return header["count"], out


def pack_lod(res_dir: Path, remove_loose: bool = True) -> int:
    """Fold every tile of the LOD into a pack; returns the tile count."""
    index_path = res_dir / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    tiles_dir = res_dir / TILES_DIR
    metric_ids = list(index["metrics"].keys())
    packed = 0
    for tile in index["tiles"]:
        tile_id = tile["id"]
        count = tile["count"]
        pack_path = tiles_dir / f"{tile_id}.pack"
        sections: dict[str, tuple[str, int, bytes]] = {}
        if pack_path.exists():
            _, existing = decode_pack(pack_path.read_bytes())
            sections.update(existing)
        pos_path = tiles_dir / f"{tile_id}.positions.bin"
        if pos_path.exists():
            sections["positions"] = ("f32", 2, pos_path.read_bytes())
        for metric_id in metric_ids:
            for storage in ("f32", "u8"):
                p = tiles_dir / f"{tile_id}.{metric_id}.{storage}"
                if p.exists():
                    sections[metric_id] = (storage, 1, p.read_bytes())
        if "positions" not in sections:
            raise SystemExit(f"{tile_id}: no positions (neither loose nor packed)")
        # positions first, then metrics in index order
        ordered = [("positions", *sections["positions"])]
        for metric_id in metric_ids:
            if metric_id in sections:
                ordered.append((metric_id, *sections[metric_id]))
        pack_path.write_bytes(encode_pack(count, ordered))
        if remove_loose:
            pos_path.unlink(missing_ok=True)
            for metric_id in metric_ids:
                for storage in ("f32", "u8"):
                    (tiles_dir / f"{tile_id}.{metric_id}.{storage}").unlink(missing_ok=True)
        packed += 1
    index["packed"] = True
    index_path.write_text(json.dumps(index, indent=1), encoding="utf-8")

    # the dataset manifest points the app at the packs
    dataset_path = res_dir.parent / "dataset.json"
    if dataset_path.exists():
        dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
        for lod in dataset.get("lods", []):
            if lod.get("resolution") == index.get("resolution") and lod.get("tileIndex"):
                lod["tilePackTemplate"] = f"r{lod['resolution']}/{TILES_DIR}/{{tile}}.pack"
        dataset_path.write_text(json.dumps(dataset, indent=1), encoding="utf-8")
    return packed


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lod", required=True, help="LOD directory with index.json and tiles/")
    parser.add_argument("--keep-loose", action="store_true", help="do not delete the per-metric files")
    args = parser.parse_args(argv)
    n = pack_lod(Path(args.lod), remove_loose=not args.keep_loose)
    print(f"packed {n:,} tiles in {args.lod}", file=sys.stderr)


if __name__ == "__main__":
    main()
