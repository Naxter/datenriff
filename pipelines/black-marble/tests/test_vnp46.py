"""VNP46A4 tile geometry, masking, discovery and sampling — synthetic tiles."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from urllib.request import pathname2url

from blackmarble import vnp46

try:  # the reader needs h5py + numpy; CI runs the stdlib-only tests without them
    import h5py  # noqa: F401
    import numpy  # noqa: F401

    HAVE_HDF = True
except ImportError:  # pragma: no cover
    HAVE_HDF = False

needs_hdf = unittest.skipUnless(HAVE_HDF, "h5py/numpy not installed")


def write_fake_tile(path: Path, radiance, quality, scale=1.0, fill=vnp46.DEFAULT_FILL):
    """A tile in the collection 002 layout: float32 radiance, -999.9 fill."""
    import h5py

    with h5py.File(path, "w") as f:
        grid = f.create_group(vnp46.GRID_PATH)
        ds = grid.create_dataset(vnp46.RADIANCE_LAYER, data=radiance)
        ds.attrs["scale_factor"] = [scale]
        ds.attrs["offset"] = [0.0]
        ds.attrs["_FillValue"] = [fill]
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

    def test_bbox_of_tile_stays_inside_its_own_tile(self):
        west, south, east, north = vnp46.bbox_of_tile("h18v03")
        self.assertTrue(0.0 < west < east < 10.0)
        self.assertTrue(50.0 < south < north < 60.0)
        # a catalogue query for this box must not also match the neighbours
        self.assertEqual(vnp46.tiles_for_bbox((west, south, east, north)), ["h18v03"])


class TestCatalogue(unittest.TestCase):
    """CMR's umm_json shape — the part that breaks when NASA moves hosts."""

    PAYLOAD = {
        "items": [
            {
                "umm": {
                    "GranuleUR": "LAADS:1",
                    "RelatedUrls": [
                        {"Type": "GET DATA",
                         "URL": "https://data.laadsdaac.earthdatacloud.nasa.gov/prod-lads/"
                                "VNP46A4/VNP46A4.A2020001.h18v03.002.2025086171445.h5"},
                        {"Type": "GET DATA VIA DIRECT ACCESS",
                         "URL": "s3://prod-lads/VNP46A4/VNP46A4.A2020001.h18v03.002.h5"},
                        {"Type": "VIEW RELATED INFORMATION",
                         "URL": "http://doi.org/10.5067/VIIRS/VNP46A4.002"},
                    ],
                }
            }
        ]
    }

    def test_only_the_https_download_is_taken(self):
        got = vnp46.granules_from_umm(self.PAYLOAD)
        self.assertEqual(list(got), ["VNP46A4.A2020001.h18v03.002.2025086171445.h5"])
        self.assertTrue(next(iter(got.values())).startswith("https://"))

    def test_empty_response(self):
        self.assertEqual(vnp46.granules_from_umm({}), {})


class TestDownloadPicksTheYear(unittest.TestCase):
    """The catalogue window returns the previous year's granule as well: it
    ends on 1 January of the year asked for. Sorting alone picks it."""

    def test_previous_year_granule_is_not_taken(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src"
            src.mkdir()
            wanted = "VNP46A4.A2020001.h18v03.002.111.h5"
            decoy = "VNP46A4.A2021001.h18v03.002.999.h5"  # sorts last
            (src / wanted).write_bytes(b"the right year")
            (src / decoy).write_bytes(b"the next year")
            urls = {n: "file:" + pathname2url(str(src / n)) for n in (wanted, decoy)}
            tiles_dir = Path(tmp) / "tiles"
            old = os.environ.get("EARTHDATA_TOKEN")
            os.environ["EARTHDATA_TOKEN"] = "test-token"
            try:
                got = vnp46.download(2020, "h18v03", tiles_dir, urls)
            finally:
                if old is None:
                    os.environ.pop("EARTHDATA_TOKEN", None)
                else:
                    os.environ["EARTHDATA_TOKEN"] = old
            self.assertEqual(got.name, wanted)
            self.assertEqual(got.read_bytes(), b"the right year")

    def test_missing_year_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit):
                vnp46.download(2099, "h18v03", Path(tmp), {"VNP46A4.A2020001.h18v03.002.1.h5": "x"})


@needs_hdf
class TestReadAndSample(unittest.TestCase):
    def setUp(self):
        import numpy as np

        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        # 4 × 4 "tile" at the h18v03 origin (0°E, 60°N): pixel (r, c) centre
        # is (0.5 + c) / 240 °E, 60 − (0.5 + r) / 240 °N
        rad = np.full((4, 4), vnp46.DEFAULT_FILL, dtype="float32")   # fill everywhere
        rad[0, 0] = 12.0    # good
        rad[0, 1] = 0.5     # good, but at the floor: dark, not absent
        rad[1, 0] = 30.0    # bright but poor quality (1)
        rad[1, 1] = 4.0     # gap-filled (2)
        rad[2, 2] = 90.0    # good
        quality = np.full((4, 4), 255, dtype="uint8")
        quality[0, 0] = 0
        quality[0, 1] = 0
        quality[1, 0] = 1
        quality[1, 1] = 2
        quality[2, 2] = 0
        self.path = self.dir / "VNP46A4.A2020001.h18v03.002.2025123456789.h5"
        write_fake_tile(self.path, rad, quality)

    def tearDown(self):
        self.tmp.cleanup()

    def test_read_applies_fill_and_keeps_radiance(self):
        import numpy as np

        radiance, quality, origin = vnp46.read_tile(self.path)
        self.assertEqual(origin, (0.0, 60.0))
        self.assertAlmostEqual(float(radiance[0, 0]), 12.0, places=5)
        self.assertTrue(np.isnan(radiance[3, 3]), "fill becomes NaN")
        self.assertEqual(int(quality[1, 0]), 1)

    def test_read_still_applies_a_scale_factor_when_the_file_has_one(self):
        import numpy as np

        raw = np.full((2, 2), 65535, dtype="uint16")
        raw[0, 0] = 120
        scaled = self.dir / "VNP46A4.A2019001.h18v03.001.1.h5"
        write_fake_tile(scaled, raw, np.zeros((2, 2), dtype="uint8"), scale=0.1, fill=65535)
        radiance, _, _ = vnp46.read_tile(scaled)
        self.assertAlmostEqual(float(radiance[0, 0]), 12.0, places=5)
        self.assertTrue(np.isnan(radiance[1, 1]))

    def test_sample_masks_quality_and_clamps_at_the_floor(self):
        radiance, quality, origin = vnp46.read_tile(self.path)
        bbox = (0.0, 59.9, 0.1, 60.0)
        got = list(vnp46.sample_tile(radiance, quality, origin, bbox, floor=0.5))
        values = sorted(round(v, 3) for _, _, v in got)
        # 12.0 (good), 4.0 (gap-filled) and 90.0 (good) keep their value; the
        # 0.5 is at the floor and comes through as a dark 0.0 rather than
        # vanishing, because a dark pixel still belongs to its cell. The 30.0
        # is poor quality and the rest is fill, so those do drop out.
        self.assertEqual(values, [0.0, 4.0, 12.0, 90.0])
        lon, lat, v = next(s for s in got if abs(s[2] - 12.0) < 1e-6)
        self.assertAlmostEqual(lon, 0.5 / 240, places=9)
        self.assertAlmostEqual(lat, 60 - 0.5 / 240, places=9)

    def test_keep_quality_can_include_poor_pixels(self):
        radiance, quality, origin = vnp46.read_tile(self.path)
        bbox = (0.0, 59.9, 0.1, 60.0)
        got = list(vnp46.sample_tile(radiance, quality, origin, bbox, 0.5, keep_quality=(0, 1, 2)))
        self.assertIn(30.0, [round(v, 3) for _, _, v in got])

    def test_tile_file_lookup_ignores_production_stamp(self):
        self.assertEqual(vnp46.tile_file(self.dir, 2020, "h18v03"), self.path)
        self.assertIsNone(vnp46.tile_file(self.dir, 2021, "h18v03"))

    def test_bbox_outside_tile_yields_nothing(self):
        radiance, quality, origin = vnp46.read_tile(self.path)
        self.assertEqual(
            list(vnp46.sample_tile(radiance, quality, origin, (20, 20, 21, 21), 0.5)), []
        )


@needs_hdf
class TestRingClip(unittest.TestCase):
    """The array clip must answer exactly what the per-point test answers —
    it replaced it because 500 m pixels made the loop cost minutes."""

    RINGS = [
        [(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (2.0, 2.0), (0.0, 4.0), (0.0, 0.0)],
        [(6.0, 6.0), (8.0, 6.0), (8.0, 8.0), (6.0, 8.0), (6.0, 6.0)],
    ]

    def test_matches_the_scalar_test_on_a_grid(self):
        import numpy as np

        from blackmarble.pipeline import mask_in_rings, point_in_rings

        xs = np.linspace(-1.0, 9.0, 61)
        ys = np.linspace(-1.0, 9.0, 61)
        grid_x, grid_y = [a.ravel() for a in np.meshgrid(xs, ys)]
        want = np.array([point_in_rings(x, y, self.RINGS) for x, y in zip(grid_x, grid_y)])
        got = mask_in_rings(grid_x, grid_y, self.RINGS)
        self.assertTrue(bool(want.any()) and not bool(want.all()), "test points must straddle")
        np.testing.assert_array_equal(got, want)

    def test_horizontal_edges_do_not_divide_by_zero(self):
        """A point on a horizontal edge makes the denominator zero. Whatever
        the even-odd rule then says, it must not raise and must not differ
        from the scalar test."""
        import numpy as np

        from blackmarble.pipeline import mask_in_rings, point_in_rings

        lons = np.array([2.0, 0.0, 9.0])
        lats = np.array([0.0, 0.0, 9.0])
        with np.errstate(all="raise"):
            got = mask_in_rings(lons, lats, self.RINGS)
        want = [point_in_rings(x, y, self.RINGS) for x, y in zip(lons, lats)]
        self.assertEqual(got.tolist(), want)


class TestPipelineYears(unittest.TestCase):
    def test_parse_years(self):
        from blackmarble.pipeline import parse_years

        self.assertEqual(parse_years("2012-2014,2020"), [2012, 2013, 2014, 2020])
        with self.assertRaises(SystemExit):
            parse_years("")

    @needs_hdf
    def test_two_years_share_the_union_universe(self):
        import struct

        import numpy as np

        from blackmarble import pipeline

        with tempfile.TemporaryDirectory() as tmp:
            tiles = Path(tmp) / "tiles"
            tiles.mkdir()
            # 2020: one lit pixel at (0,0); 2021: that one brighter, plus a
            # second one ~1.4 km away that lands in a different r8 cell
            rad20 = np.full((8, 8), vnp46.DEFAULT_FILL, dtype="float32")
            rad21 = rad20.copy()
            q = np.zeros((8, 8), dtype="uint8")
            rad20[0, 0] = 20.0
            rad21[0, 0] = 40.0
            rad21[7, 7] = 10.0          # ~1.4 km away: a different r8 cell
            write_fake_tile(tiles / "VNP46A4.A2020001.h18v03.002.1.h5", rad20, q)
            write_fake_tile(tiles / "VNP46A4.A2021001.h18v03.002.1.h5", rad21, q)
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
            # the second cell's only 2020 pixel is fill: nothing was
            # measured there, so the year reads as missing — a genuinely
            # dark pixel would have been kept as 0.0 and produced a 0.0 mean
            import math

            self.assertTrue(
                any(math.isnan(v) for v in v20),
                "cell with only fill pixels in 2020 is missing, not dark",
            )
            measured20 = [v for v in v20 if not math.isnan(v)]
            self.assertAlmostEqual(max(measured20), 20.0, places=4)
            self.assertAlmostEqual(sorted(v21)[-1], 40.0, places=4)
            lods = {lod["resolution"]: lod for lod in manifest["lods"]}
            self.assertIn("light_2021", lods[8]["metricStats"])
            # r8 streams as tiles, the country LOD r7 does not
            self.assertIn("tileIndex", lods[8])
            self.assertNotIn("tileIndex", lods[7])
            index = json.loads((out / "r8" / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(sum(t["count"] for t in index["tiles"]), len(cells))
            self.assertTrue((out / "r8" / "tiles").is_dir())


if __name__ == "__main__":
    unittest.main()


class TestTokenNeverLeaves(unittest.TestCase):
    """The download URL comes out of the CMR catalogue and urllib re-sends
    headers across redirects, so the bearer token is only ever offered to a
    host on the allowlist — before the request and again at every hop."""

    def test_nasa_hosts_are_allowed(self):
        for url in (
            "https://data.laadsdaac.earthdatacloud.nasa.gov/x.h5",
            "https://ladsweb.modaps.eosdis.nasa.gov/x.h5",
            "https://cmr.earthdata.nasa.gov/x.h5",
        ):
            self.assertEqual(vnp46._token_target(url), url)

    def test_another_host_is_refused(self):
        with self.assertRaises(SystemExit):
            vnp46._token_target("https://example.invalid/x.h5")

    def test_a_suffix_lookalike_is_refused(self):
        # "nasa.gov.evil.com" ends with neither ".nasa.gov" nor "nasa.gov"
        with self.assertRaises(SystemExit):
            vnp46._token_target("https://nasa.gov.evil.com/x.h5")

    def test_plain_http_is_refused(self):
        with self.assertRaises(SystemExit):
            vnp46._token_target("http://data.laadsdaac.earthdatacloud.nasa.gov/x.h5")

    def test_a_redirect_off_the_allowlist_is_refused(self):
        handler = vnp46._SameHostRedirect()
        with self.assertRaises(SystemExit):
            handler.redirect_request(None, None, 302, "Found", {}, "https://example.invalid/x.h5")
