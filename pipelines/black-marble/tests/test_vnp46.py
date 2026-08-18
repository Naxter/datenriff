"""VNP46A4 tile geometry, masking and sampling against a synthetic tile."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from blackmarble import vnp46

try:  # the reader needs h5py + numpy; CI runs the stdlib-only tests without them
    import h5py  # noqa: F401
    import numpy  # noqa: F401

    HAVE_HDF = True
except ImportError:  # pragma: no cover
    HAVE_HDF = False

needs_hdf = unittest.skipUnless(HAVE_HDF, "h5py/numpy not installed")


def write_fake_tile(path: Path, radiance_raw, quality):
    import h5py

    with h5py.File(path, "w") as f:
        grid = f.create_group(vnp46.GRID_PATH)
        ds = grid.create_dataset(vnp46.RADIANCE_LAYER, data=radiance_raw)
        ds.attrs["scale_factor"] = 0.1
        ds.attrs["_FillValue"] = 65535
        grid.create_dataset(vnp46.QUALITY_LAYER, data=quality)


class TestTileGeometry(unittest.TestCase):
    def test_germany_needs_four_tiles(self):
        self.assertEqual(
            vnp46.tiles_for_bbox((5.8, 47.2, 15.1, 55.1)),
            ["h18v03", "h18v04", "h19v03", "h19v04"],
        )

    def test_origin(self):
        self.assertEqual(vnp46.tile_origin("h18v03"), (0.0, 60.0))
        self.assertEqual(vnp46.tile_origin("h19v04"), (10.0, 50.0))
        with self.assertRaises(ValueError):
            vnp46.tile_origin("x")

    def test_pixel_size_is_15_arcseconds(self):
        self.assertAlmostEqual(vnp46.PIXEL_DEGREES * 3600, 15.0)


@needs_hdf
class TestReadAndSample(unittest.TestCase):
    def setUp(self):
        import numpy as np

        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        # 4 × 4 "tile" at the h18v03 origin (0°E, 60°N): pixel (r, c) centre
        # is (0.5 + c) / 240 °E, 60 − (0.5 + r) / 240 °N
        raw = np.full((4, 4), 65535, dtype="uint16")   # fill everywhere
        raw[0, 0] = 120     # 12.0 nW, good
        raw[0, 1] = 5       # 0.5 nW, good but at the floor
        raw[1, 0] = 300     # 30.0 nW but ephemeral (quality 1)
        raw[1, 1] = 40      # 4.0 nW, gap-filled (quality 2)
        raw[2, 2] = 900     # 90.0 nW, good
        quality = np.full((4, 4), 255, dtype="uint8")
        quality[0, 0] = 0
        quality[0, 1] = 0
        quality[1, 0] = 1
        quality[1, 1] = 2
        quality[2, 2] = 0
        self.path = self.dir / "VNP46A4.A2020001.h18v03.001.2021123456789.h5"
        write_fake_tile(self.path, raw, quality)

    def tearDown(self):
        self.tmp.cleanup()

    def test_read_applies_scale_and_fill(self):
        import numpy as np

        radiance, quality, origin = vnp46.read_tile(self.path)
        self.assertEqual(origin, (0.0, 60.0))
        self.assertAlmostEqual(float(radiance[0, 0]), 12.0, places=5)
        self.assertTrue(np.isnan(radiance[3, 3]), "fill becomes NaN")
        self.assertEqual(int(quality[1, 0]), 1)

    def test_sample_masks_quality_and_floor(self):
        radiance, quality, origin = vnp46.read_tile(self.path)
        bbox = (0.0, 59.9, 0.1, 60.0)
        got = list(vnp46.sample_tile(radiance, quality, origin, bbox, floor=0.5))
        values = sorted(round(v, 3) for _, _, v in got)
        # 12.0 (good), 4.0 (gap-filled) and 90.0 (good) survive; the 0.5 is
        # at the floor, the 30.0 is ephemeral, the rest is fill
        self.assertEqual(values, [4.0, 12.0, 90.0])
        lon, lat, v = next(s for s in got if abs(s[2] - 12.0) < 1e-6)
        self.assertAlmostEqual(lon, 0.5 / 240, places=9)
        self.assertAlmostEqual(lat, 60 - 0.5 / 240, places=9)

    def test_keep_quality_can_include_ephemeral(self):
        radiance, quality, origin = vnp46.read_tile(self.path)
        bbox = (0.0, 59.9, 0.1, 60.0)
        got = list(vnp46.sample_tile(radiance, quality, origin, bbox, 0.5, keep_quality=(0, 1, 2)))
        self.assertIn(30.0, [round(v, 3) for _, _, v in got])

    def test_tile_file_lookup_ignores_production_stamp(self):
        self.assertEqual(vnp46.tile_file(self.dir, 2020, "h18v03"), self.path)
        self.assertIsNone(vnp46.tile_file(self.dir, 2021, "h18v03"))

    def test_bbox_outside_tile_yields_nothing(self):
        radiance, quality, origin = vnp46.read_tile(self.path)
        self.assertEqual(list(vnp46.sample_tile(radiance, quality, origin, (20, 20, 21, 21), 0.5)), [])


class TestPipelineYears(unittest.TestCase):
    def test_parse_years(self):
        from blackmarble.pipeline import parse_years

        self.assertEqual(parse_years("2012-2014,2020"), [2012, 2013, 2014, 2020])
        with self.assertRaises(SystemExit):
            parse_years("")

    @needs_hdf
    def test_two_years_share_the_union_universe(self):
        import json
        import struct

        import numpy as np

        from blackmarble import pipeline

        with tempfile.TemporaryDirectory() as tmp:
            tiles = Path(tmp) / "tiles"
            tiles.mkdir()
            # 2020: one lit pixel at (0,0); 2021: that one brighter, plus a
            # second one ~1.4 km away that lands in a different r8 cell
            raw20 = np.full((8, 8), 65535, dtype="uint16")
            raw21 = raw20.copy()
            q = np.zeros((8, 8), dtype="uint8")
            raw20[0, 0] = 200
            raw21[0, 0] = 400
            raw21[7, 7] = 100          # ~1.4 km away: a different r8 cell
            write_fake_tile(tiles / "VNP46A4.A2020001.h18v03.001.1.h5", raw20, q)
            write_fake_tile(tiles / "VNP46A4.A2021001.h18v03.001.1.h5", raw21, q)
            out = Path(tmp) / "out"
            pipeline.main(
                [
                    "--vnp46", "--years", "2020-2021", "--tiles-dir", str(tiles), "--no-fetch",
                    "--bbox", "0,59.9,0.1,60", "--resolutions", "8,7", "--floor", "0.5",
                    "--out", str(out), "--unit", "nW/cm²/sr",
                ]
            )
            manifest = json.loads((out / "dataset.json").read_text(encoding="utf-8"))
            ids = [m["id"] for m in manifest["metrics"]]
            self.assertEqual(ids, ["light_2020", "light_2021"])
            self.assertEqual(manifest["metrics"][0]["unit"], "nW/cm²/sr")
            cells = (out / "r8" / "cells.txt").read_text().split()
            self.assertEqual(len(cells), 2, "universe = union of both years")
            n = len(cells)
            v20 = struct.unpack(f"<{n}f", (out / "r8" / "light_2020.f32").read_bytes())
            v21 = struct.unpack(f"<{n}f", (out / "r8" / "light_2021.f32").read_bytes())
            self.assertIn(0.0, v20, "cell unlit in 2020 is dark, not missing")
            self.assertAlmostEqual(sorted(v20)[-1], 20.0, places=4)
            self.assertAlmostEqual(sorted(v21)[-1], 40.0, places=4)
            r8 = next(l for l in manifest["lods"] if l["resolution"] == 8)
            self.assertIn("light_2021", r8["metricStats"])


if __name__ == "__main__":
    unittest.main()
