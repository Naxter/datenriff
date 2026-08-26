import unittest

def _skip_without(*modules):
    """Skip rather than error when the scientific stack is absent.

    CI installs it; a contributor reading the parsers may not have it,
    and an import error there looks like a broken repo."""
    import importlib
    for name in modules:
        try:
            importlib.import_module(name)
        except ImportError:
            raise unittest.SkipTest(f'{name} is not installed')

_skip_without('h3', 'numpy', 'rasterio')

import json
import tempfile
import unittest
from pathlib import Path

import h3
import numpy as np

from forest import pipeline, raster
from tests.test_raster import write_set


def counts(forest=0, disturbed=0, agents=(0, 0, 0, 0)):
    row = np.zeros(pipeline.WIDTH, dtype="int64")
    row[pipeline.FOREST] = forest
    row[pipeline.DISTURBED] = disturbed
    row[pipeline.AGENT0:] = agents
    return row


class TestMetrics(unittest.TestCase):
    def setUp(self):
        self.cell = h3.latlng_to_cell(51.0, 10.0, 8)
        self.area = h3.cell_area(self.cell, unit="km^2")

    def test_forest_share_is_area_not_pixel_count(self):
        # half the cell covered, in 30 m pixels
        pixels = round(self.area / 2 / pipeline.PIXEL_AREA_KM2)
        share, *_ = pipeline.metrics_of(counts(forest=pixels), self.cell)
        self.assertAlmostEqual(share, 0.5, places=2)

    def test_forest_share_never_exceeds_one(self):
        pixels = round(self.area * 3 / pipeline.PIXEL_AREA_KM2)
        share, *_ = pipeline.metrics_of(counts(forest=pixels), self.cell)
        self.assertEqual(share, 1.0)

    def test_disturbed_share_is_a_share_of_the_forest(self):
        _, disturbed, _, _ = pipeline.metrics_of(counts(forest=200, disturbed=50), self.cell)
        self.assertAlmostEqual(disturbed, 0.25)

    def test_a_cell_without_forest_has_no_disturbance(self):
        share, disturbed, agent, dominance = pipeline.metrics_of(counts(), self.cell)
        self.assertEqual(share, 0.0)
        self.assertIsNone(disturbed)
        self.assertIsNone(agent)

    def test_undisturbed_forest_names_no_cause(self):
        share, disturbed, agent, dominance = pipeline.metrics_of(counts(forest=100), self.cell)
        self.assertGreater(share, 0)
        self.assertEqual(disturbed, 0.0)
        self.assertIsNone(agent, "forest that was never disturbed has no cause")
        # and with no cause there is no dominance to measure — a 0 would
        # enter the dominance stats as a measured value
        self.assertIsNone(dominance)

    def test_dominant_cause_and_its_strength(self):
        # 6 harvest, 2 fire, 2 wind: harvest with 60 %
        _, _, agent, dominance = pipeline.metrics_of(
            counts(forest=100, disturbed=10, agents=(2, 2, 6, 0)), self.cell
        )
        self.assertEqual(raster.AGENT_LABELS[agent], "Harvest")
        self.assertEqual(dominance, round(0.6 * 255))


class TestPooling(unittest.TestCase):
    def test_parents_add_up_their_children(self):
        parent = h3.latlng_to_cell(51.0, 10.0, 7)
        first, second = sorted(h3.cell_to_children(parent, 8))[:2]
        children = {
            first: counts(forest=10, disturbed=4, agents=(4, 0, 0, 0)),
            second: counts(forest=6, disturbed=1, agents=(0, 1, 0, 0)),
        }
        parents = pipeline.to_parent(children, 7)
        self.assertEqual(len(parents), 1)
        pooled = next(iter(parents.values()))
        self.assertEqual(pooled[pipeline.FOREST], 16)
        self.assertEqual(pooled[pipeline.DISTURBED], 5)
        self.assertEqual(pooled[pipeline.AGENT0:].tolist(), [4, 1, 0, 0])

    def test_pooling_shares_would_differ_from_pooling_counts(self):
        # the reason counts are carried: two cells of very different size
        big = counts(forest=1000, disturbed=100)
        small = counts(forest=10, disturbed=10)
        pooled = (big + small)[pipeline.DISTURBED] / (big + small)[pipeline.FOREST]
        mean_of_shares = (100 / 1000 + 10 / 10) / 2
        self.assertAlmostEqual(pooled, 110 / 1010)
        self.assertNotAlmostEqual(pooled, mean_of_shares)


class TestRun(unittest.TestCase):
    def test_end_to_end_writes_buffers_and_a_manifest(self):
        rng = np.random.default_rng(7)
        mask = (rng.random((64, 64)) < 0.6).astype("uint8")
        latest = np.where(rng.random((64, 64)) < 0.2, 2019, 0)
        agent = np.where(latest > 0, 1, 255)
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            src = d / "src"
            src.mkdir()
            # a patch of Germany, in EPSG:3035 metres
            write_set(src, "testland", mask, latest, agent, origin=(4300000.0, 3000000.0))
            out = d / "out"
            pipeline.main([
                "--input", str(src), "--country", "testland", "--out", str(out),
                "--resolutions", "8,7", "--tiled", "", "--block", "2",
            ])
            manifest = json.loads((out / "dataset.json").read_text(encoding="utf-8"))
            ids = {m["id"] for m in manifest["metrics"]}
            self.assertEqual(
                ids,
                {"forest_share", "disturbed_share", "disturbance_agent",
                 "disturbance_agent_dominance"},
            )
            self.assertEqual({lod["resolution"] for lod in manifest["lods"]}, {8, 7})
            for res in (8, 7):
                self.assertTrue((out / f"r{res}" / "forest_share.f32").exists())
                self.assertTrue((out / f"r{res}" / "positions.bin").exists())
            self.assertEqual(manifest["source"]["license"], "CC BY 4.0")

    def test_it_stops_when_there_is_no_forest(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            src = d / "src"
            src.mkdir()
            write_set(src, "testland", np.zeros((8, 8)), np.zeros((8, 8)), np.full((8, 8), 255))
            with self.assertRaises(SystemExit):
                pipeline.main([
                    "--input", str(src), "--country", "testland",
                    "--out", str(d / "out"), "--resolutions", "8,7", "--tiled", "",
                ])


if __name__ == "__main__":
    unittest.main()
