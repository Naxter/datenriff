"""Tile pack: round trip, alignment, folding of loose files, re-runs."""

from __future__ import annotations

import json
import struct
import tempfile
import unittest
from pathlib import Path

from zensus_pipeline import pack
from zensus_pipeline.binary_writer import write_f32, write_positions, write_u8


class TestEncode(unittest.TestCase):
    def test_round_trip_and_alignment(self):
        blob = pack.encode_pack(
            3,
            [
                ("positions", "f32", 2, struct.pack("<6f", 1, 2, 3, 4, 5, 6)),
                ("flag", "u8", 1, bytes([1, 2, 3])),          # 3 bytes: next must be padded
                ("value", "f32", 1, struct.pack("<3f", 7, 8, 9)),
            ],
        )
        self.assertEqual(blob[:4], b"DRTL")
        count, sections = pack.decode_pack(blob)
        self.assertEqual(count, 3)
        self.assertEqual(sections["flag"], ("u8", 1, bytes([1, 2, 3])))
        self.assertEqual(struct.unpack("<3f", sections["value"][2]), (7.0, 8.0, 9.0))
        header_len = struct.unpack_from("<I", blob, 8)[0]
        header = json.loads(blob[12:12 + header_len])
        offsets = {s["name"]: s["offset"] for s in header["sections"]}
        self.assertEqual(offsets["value"] % 4, 0, "f32 sections are 4-byte aligned")
        self.assertEqual(header_len % 4, 0, "payload starts aligned")

    def test_rejects_garbage(self):
        with self.assertRaises(ValueError):
            pack.decode_pack(b"nope")


class TestPackLod(unittest.TestCase):
    def make_lod(self, root: Path) -> Path:
        res_dir = root / "r9"
        tiles = res_dir / "tiles"
        tiles.mkdir(parents=True)
        write_positions(tiles / "t1.positions.bin", [(10.0, 50.0), (10.1, 50.1)])
        write_f32(tiles / "t1.population.f32", [5.0, None])
        write_u8(tiles / "t1.heating.u8", [2, None])
        (res_dir / "index.json").write_text(json.dumps({
            "resolution": 9,
            "cellRadiusMeters": 174.4,
            "metrics": {"population": {"min": 0}, "heating": {"min": 0}},
            "tiles": [{"id": "t1", "count": 2, "bounds": [10, 50, 10.1, 50.1]}],
        }))
        (root / "dataset.json").write_text(json.dumps({
            "lods": [{"resolution": 9, "tileIndex": "r9/index.json",
                      "tileTemplate": "r9/tiles/{tile}.{metric}"}]
        }))
        return res_dir

    def test_folds_loose_files_and_updates_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            res_dir = self.make_lod(Path(tmp))
            n = pack.pack_lod(res_dir)
            self.assertEqual(n, 1)
            tiles = res_dir / "tiles"
            self.assertEqual(sorted(p.name for p in tiles.iterdir()), ["t1.pack"])
            count, sections = pack.decode_pack((tiles / "t1.pack").read_bytes())
            self.assertEqual(count, 2)
            self.assertEqual(list(sections), ["positions", "population", "heating"])
            self.assertEqual(sections["heating"][2], bytes([2, 255]))
            self.assertTrue(json.loads((res_dir / "index.json").read_text())["packed"])
            ds = json.loads((Path(tmp) / "dataset.json").read_text())
            self.assertEqual(ds["lods"][0]["tilePackTemplate"], "r9/tiles/{tile}.pack")

    def test_rerun_folds_new_metric_into_existing_pack(self):
        with tempfile.TemporaryDirectory() as tmp:
            res_dir = self.make_lod(Path(tmp))
            pack.pack_lod(res_dir)
            # a later metric run writes a loose file and registers its stats
            write_f32(res_dir / "tiles" / "t1.rent.f32", [7.5, 8.0])
            index = json.loads((res_dir / "index.json").read_text())
            index["metrics"]["rent"] = {"min": 0}
            (res_dir / "index.json").write_text(json.dumps(index))
            pack.pack_lod(res_dir)
            _, sections = pack.decode_pack((res_dir / "tiles" / "t1.pack").read_bytes())
            self.assertEqual(list(sections), ["positions", "population", "heating", "rent"])
            self.assertEqual(struct.unpack("<2f", sections["rent"][2]), (7.5, 8.0))
            self.assertFalse((res_dir / "tiles" / "t1.rent.f32").exists())


if __name__ == "__main__":
    unittest.main()
