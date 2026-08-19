"""ASCII grid reader, aggregation and an end-to-end run on a synthetic grid."""

from __future__ import annotations

import gzip
import json
import struct
import tempfile
import unittest
from pathlib import Path

from dwd import grids
from dwd.pipeline import accumulate_mean, aggregate_mean_to_parent, parse_years

try:
    import pyproj  # noqa: F401

    HAVE_PYPROJ = True
except ImportError:  # pragma: no cover
    HAVE_PYPROJ = False

needs_pyproj = unittest.skipUnless(HAVE_PYPROJ, "pyproj not installed")

# 3 x 2 cells of 1 km around the middle of Germany; -999 is NODATA
GRID = """NCOLS 3
NROWS 2
XLLCORNER 3600000
YLLCORNER 5670000
CELLSIZE 1000
NODATA_VALUE -999
 700 800 -999
 -999 900 1000
"""


def write_grid(path: Path, text: str = GRID) -> None:
    with gzip.open(path, "wt") as fh:
        fh.write(text)


class TestHeader(unittest.TestCase):
    def test_header_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "g.asc.gz"
            write_grid(p)
            with gzip.open(p, "rt") as fh:
                h = grids.read_header(fh)
            self.assertEqual((h.ncols, h.nrows), (3, 2))
            self.assertEqual((h.xllcorner, h.yllcorner), (3600000.0, 5670000.0))
            self.assertEqual(h.cellsize, 1000.0)
            self.assertEqual(h.nodata, -999.0)

    def test_url_and_local_name(self):
        self.assertTrue(
            grids.annual_url("precipitation", 2024).endswith(
                "grids_germany_annual_precipitation_202417.asc.gz"
            )
        )
        self.assertEqual(
            grids.local_path(Path("d"), "precipitation", 2024).name,
            "grids_germany_annual_precipitation_202417.asc.gz",
        )


@needs_pyproj
class TestSampleGrid(unittest.TestCase):
    def samples(self, text: str = GRID):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "g.asc.gz"
            write_grid(p, text)
            return list(grids.sample_grid(p))

    def test_nodata_is_skipped(self):
        values = sorted(v for _, _, v in self.samples())
        self.assertEqual(values, [700.0, 800.0, 900.0, 1000.0])

    def test_cells_land_in_germany_and_rows_run_north_first(self):
        got = self.samples()
        for lon, lat, _ in got:
            self.assertTrue(5.5 < lon < 15.5, lon)
            self.assertTrue(47.0 < lat < 55.5, lat)
        # first row of the file is the northern one
        north = next(lat for _, lat, v in got if v == 700.0)
        south = next(lat for _, lat, v in got if v == 900.0)
        self.assertGreater(north, south)

    def test_scale_is_applied(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "g.asc.gz"
            write_grid(p)
            values = sorted(v for _, _, v in grids.sample_grid(p, scale=0.1))
            self.assertEqual(values, [70.0, 80.0, 90.0, 100.0])

    def test_short_row_is_an_error(self):
        with self.assertRaises(SystemExit):
            self.samples(GRID.replace(" 700 800 -999", " 700 800"))


class TestAggregation(unittest.TestCase):
    def test_mean_not_sum(self):
        means, counts = accumulate_mean([("a", 800.0), ("a", 900.0), ("b", 500.0)])
        self.assertEqual(means["a"], 850.0)
        self.assertEqual(counts, {"a": 2, "b": 1})

    def test_parent_is_weighted_by_pixel_count(self):
        means = {"a": 1000.0, "b": 500.0}
        counts = {"a": 3, "b": 1}
        parents, weights = aggregate_mean_to_parent(means, counts, lambda c: "P")
        # (1000*3 + 500*1) / 4 = 875, not the 750 a mean of means would give
        self.assertAlmostEqual(parents["P"], 875.0)
        self.assertEqual(weights["P"], 4)

    def test_parse_years(self):
        self.assertEqual(parse_years("2001-2003,2010"), [2001, 2002, 2003, 2010])
        with self.assertRaises(SystemExit):
            parse_years("")


@needs_pyproj
class TestPipeline(unittest.TestCase):
    def test_end_to_end(self):
        from dwd import pipeline

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache"
            cache.mkdir()
            write_grid(grids.local_path(cache, "precipitation", 2020))
            write_grid(
                grids.local_path(cache, "precipitation", 2021),
                GRID.replace(" 700 800 -999", " 100 200 -999"),
            )
            out = Path(tmp) / "out"
            pipeline.main([
                "--out", str(out), "--years", "2020-2021", "--cache", str(cache),
                "--no-fetch", "--resolutions", "8,7", "--tiled", "8",
            ])
            manifest = json.loads((out / "dataset.json").read_text(encoding="utf-8"))
            self.assertEqual([m["id"] for m in manifest["metrics"]],
                             ["rain_mm_2020", "rain_mm_2021"])
            self.assertEqual(manifest["metrics"][0]["unit"], "mm")
            self.assertEqual(manifest["source"]["license"], pipeline.LICENSE)
            # r7 is the country LOD (un-tiled), r8 is tiled
            lods = {l["resolution"]: l for l in manifest["lods"]}
            self.assertNotIn("tileIndex", lods[7])
            self.assertIn("tileIndex", lods[8])
            self.assertTrue((out / "r8" / "index.json").exists())
            index = json.loads((out / "r8" / "index.json").read_text(encoding="utf-8"))
            self.assertTrue(all("bounds" in t for t in index["tiles"]))
            cells = (out / "r7" / "cells.txt").read_text().split()
            n = len(cells)
            v = struct.unpack(f"<{n}f", (out / "r7" / "rain_mm_2020.f32").read_bytes())
            self.assertTrue(all(700.0 <= x <= 1000.0 for x in v), v)


if __name__ == "__main__":
    unittest.main()
