import json
import math
import struct
import tempfile
import unittest
from pathlib import Path

from zensus_pipeline.binary_writer import (
    bounds_of,
    compute_stats,
    merge_dataset_manifest,
    read_f32,
    write_f32,
    write_positions,
    write_u8,
)


class TestBinaryWriter(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_f32_roundtrip_little_endian_nan_for_missing(self):
        path = self.dir / "m.f32"
        write_f32(path, [1.5, None, -2.0])
        raw = path.read_bytes()
        self.assertEqual(len(raw), 12)
        # Explicitly little-endian, independent of platform.
        self.assertEqual(struct.unpack("<f", raw[:4])[0], 1.5)
        values = read_f32(path)
        self.assertEqual(values[0], 1.5)
        self.assertTrue(math.isnan(values[1]))
        self.assertEqual(values[2], -2.0)

    def test_u8_missing_sentinel(self):
        path = self.dir / "m.u8"
        write_u8(path, [0, 3, None])
        self.assertEqual(path.read_bytes(), bytes([0, 3, 255]))

    def test_positions_interleaved(self):
        path = self.dir / "positions.bin"
        write_positions(path, [(10.0, 51.0), (11.5, 52.5)])
        flat = struct.unpack("<4f", path.read_bytes())
        self.assertEqual(flat, (10.0, 51.0, 11.5, 52.5))

    def test_stats_exclude_missing(self):
        values = [float(i) for i in range(1, 1001)] + [None]
        stats = compute_stats(values, with_sum=True)
        self.assertEqual(stats["min"], 1)
        self.assertEqual(stats["max"], 1000)
        self.assertEqual(stats["sum"], 500500)
        self.assertTrue(940 <= stats["p95"] <= 960)
        self.assertTrue(990 <= stats["p995"] <= 1000)

    def test_bounds(self):
        self.assertEqual(
            bounds_of([(10.0, 51.0), (6.0, 54.0), (14.0, 47.5)]),
            [6.0, 47.5, 14.0, 54.0],
        )

    def test_manifest_merge_replaces_metrics_and_merges_lods(self):
        path = self.dir / "dataset.json"
        merge_dataset_manifest(
            path,
            {
                "id": "zensus",
                "metrics": [{"id": "population_2022", "stats": {"max": 1}}],
                "lods": [{"resolution": 8, "count": 10}],
            },
        )
        merged = merge_dataset_manifest(
            path,
            {
                "id": "zensus",
                "metrics": [
                    {"id": "population_2022", "stats": {"max": 2}},
                    {"id": "population_2011", "stats": {"max": 3}},
                ],
                "lods": [{"resolution": 8, "count": 10, "minZoom": 0}],
            },
        )
        self.assertEqual(len(merged["metrics"]), 2)
        by_id = {m["id"]: m for m in merged["metrics"]}
        self.assertEqual(by_id["population_2022"]["stats"]["max"], 2)
        self.assertEqual(len(merged["lods"]), 1)
        self.assertEqual(merged["lods"][0]["minZoom"], 0)
        # File on disk matches the returned structure.
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), merged)


if __name__ == "__main__":
    unittest.main()


class TestManifestReferenceDate(unittest.TestCase):
    """A dataset is as new as its newest vintage, whatever ran last."""

    def _write(self, path, date, metric):
        merge_dataset_manifest(path, {
            "id": "land",
            "source": {"label": "BKG", "referenceDate": date},
            "metrics": [{"id": metric, "stats": {}}],
            "lods": [{"resolution": 8, "metricStats": {metric: {}}}],
        })

    def test_an_older_vintage_run_later_does_not_backdate_the_dataset(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "dataset.json"
            self._write(path, "2021-01-01", "built_share_2021")
            self._write(path, "2018-01-01", "built_share_2018")
            manifest = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["source"]["referenceDate"], "2021-01-01")
            self.assertEqual(len(manifest["metrics"]), 2, "both vintages are kept")

    def test_a_newer_vintage_does_move_it_forward(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "dataset.json"
            self._write(path, "2018-01-01", "built_share_2018")
            self._write(path, "2021-01-01", "built_share_2021")
            manifest = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["source"]["referenceDate"], "2021-01-01")
