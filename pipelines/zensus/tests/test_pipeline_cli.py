"""End-to-end CLI test with stubbed h3/pyproj, covering streaming,
accumulation, universe alignment and manifest writing."""

import json
import math
import sys
import tempfile
import types
import unittest
from pathlib import Path

from zensus_pipeline.binary_writer import read_f32


def install_stubs():
    """Fake h3/pyproj: cells are coordinate buckets, parents coarser buckets."""
    h3 = types.ModuleType("h3")

    def latlng_to_cell(lat, lon, res):
        # res 10: 1-unit buckets of the fake lon/lat; coarser: wider buckets
        size = {10: 1, 9: 2, 8: 4}[res]
        return f"c{res}_{int(lon // size) * size}_{int(lat // size) * size}"

    def cell_to_parent(cell, res):
        _, lon, lat = cell.split("_")
        return latlng_to_cell(float(lat), float(lon), res)

    def cell_to_latlng(cell):
        _, lon, lat = cell.split("_")
        return float(lat), float(lon)

    h3.latlng_to_cell = latlng_to_cell
    h3.cell_to_parent = cell_to_parent
    h3.cell_to_latlng = cell_to_latlng
    sys.modules["h3"] = h3

    pyproj = types.ModuleType("pyproj")

    class Transformer:
        @staticmethod
        def from_crs(a, b, always_xy=False):
            return Transformer()

        def transform(self, xs, ys):
            # fake "projection": metres to degree-sized units
            return [x / 100 for x in xs], [y / 100 for y in ys]

    pyproj.Transformer = Transformer
    sys.modules["pyproj"] = pyproj


class TestPipelineCli(unittest.TestCase):
    def setUp(self):
        install_stubs()
        from zensus_pipeline import pipeline

        self.pipeline = pipeline
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.out = self.dir / "out"

    def tearDown(self):
        self.tmp.cleanup()
        sys.modules.pop("h3", None)
        sys.modules.pop("pyproj", None)

    def write_csv(self, name, header, rows):
        path = self.dir / name
        lines = [header] + rows
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def population_csv(self):
        # two res-10 cells: (0,0) with 30+20, (5,0) with 50; one suppressed row
        return self.write_csv(
            "pop.csv",
            "GITTER_ID_100m;x_mp_100m;y_mp_100m;Einwohner",
            [
                "CRS3035RES100mN0E0;10;20;30",
                "CRS3035RES100mN0E1;60;20;20",
                "CRS3035RES100mN0E5;510;20;50",
                "CRS3035RES100mN0E9;910;20;–",
            ],
        )

    def run_cli(self, argv):
        self.pipeline.main(argv)

    def test_sum_then_wmean_align_to_the_same_universe(self):
        self.run_cli(
            [
                "--input", str(self.population_csv()),
                "--metric", "population",
                "--out", str(self.out),
            ]
        )
        cells = (self.out / "r8" / "cells.txt").read_text().split()
        values = read_f32(self.out / "r8" / "population.f32")
        by_cell = dict(zip(cells, values))
        self.assertEqual(by_cell["c8_0_0"], 50)  # 30 + 20 in one r8 bucket
        self.assertEqual(by_cell["c8_4_0"], 50)

        # age file lacks the second cell → NaN there, universe unchanged
        age = self.write_csv(
            "age.csv",
            "GITTER_ID_100m;x_mp_100m;y_mp_100m;Alter",
            [
                "CRS3035RES100mN0E0;10;20;40,0",
                "CRS3035RES100mN0E1;60;20;60,0",
            ],
        )
        self.run_cli(
            [
                "--input", str(age),
                "--metric", "age_mean",
                "--rule", "wmean",
                "--value-column", "Alter",
                "--weight-input", str(self.population_csv()),
                "--weight-value-column", "Einwohner",
                "--out", str(self.out),
            ]
        )
        cells_after = (self.out / "r8" / "cells.txt").read_text().split()
        self.assertEqual(cells, cells_after, "universe is stable across runs")
        age_values = dict(zip(cells_after, read_f32(self.out / "r8" / "age_mean.f32")))
        self.assertAlmostEqual(age_values["c8_0_0"], (40 * 30 + 60 * 20) / 50, places=3)
        self.assertTrue(math.isnan(age_values["c8_4_0"]))

        manifest = json.loads((self.out / "dataset.json").read_text(encoding="utf-8"))
        ids = {m["id"] for m in manifest["metrics"]}
        self.assertEqual(ids, {"population", "age_mean"})
        self.assertTrue(manifest["source"]["provenance"]["sourceHash"].startswith("sha256:"))

    def test_share_rule_pools_parts_and_suppresses_small_denominators(self):
        vacancy = self.write_csv(
            "vacancy.csv",
            "GITTER_ID_100m;x_mp_100m;y_mp_100m;Leerstehend;Wohnungen",
            [
                # one r8 bucket: 3/100 and 27/200 pool to 30/300, not mean(3%, 13.5%)
                "CRS3035RES100mN0E0;10;20;3;100",
                "CRS3035RES100mN0E1;60;20;27;200",
                # separate bucket, denominator below the threshold → suppressed
                "CRS3035RES100mN0E5;510;20;2;8",
            ],
        )
        self.run_cli(
            [
                "--input", str(vacancy),
                "--metric", "vacancy_rate",
                "--rule", "share",
                "--numerator-column", "Leerstehend",
                "--denominator-column", "Wohnungen",
                "--min-denominator", "25",
                "--out", str(self.out),
            ]
        )
        cells = (self.out / "r8" / "cells.txt").read_text().split()
        values = dict(zip(cells, read_f32(self.out / "r8" / "vacancy_rate.f32")))
        self.assertAlmostEqual(values["c8_0_0"], 30 / 300, places=6)
        self.assertTrue(math.isnan(values["c8_4_0"]))
        manifest = json.loads((self.out / "dataset.json").read_text(encoding="utf-8"))
        metric = next(m for m in manifest["metrics"] if m["id"] == "vacancy_rate")
        self.assertEqual(metric["aggregation"], "share")

    def test_category_rule_writes_dominant_and_dominance(self):
        heating = self.write_csv(
            "heat.csv",
            "GITTER_ID_100m;x_mp_100m;y_mp_100m;Gas;Oel",
            [
                "CRS3035RES100mN0E0;10;20;70;30",
                "CRS3035RES100mN0E1;60;20;10;40",
            ],
        )
        self.run_cli(
            [
                "--input", str(heating),
                "--metric", "heating",
                "--rule", "category",
                "--category-columns", "Gas,Oel",
                "--category-labels", "Gas,Heizöl",
                "--out", str(self.out),
            ]
        )
        cells = (self.out / "r8" / "cells.txt").read_text().split()
        cats = (self.out / "r8" / "heating_category.u8").read_bytes()
        doms = (self.out / "r8" / "heating_dominance.u8").read_bytes()
        by_cell = dict(zip(cells, cats))
        # both rows share one r8 bucket: gas 80 vs oil 70 → gas dominant
        self.assertEqual(by_cell["c8_0_0"], 0)
        self.assertEqual(doms[cells.index("c8_0_0")], round(80 / 150 * 255))
        manifest = json.loads((self.out / "dataset.json").read_text(encoding="utf-8"))
        cat_metric = next(m for m in manifest["metrics"] if m["id"] == "heating_category")
        self.assertEqual(cat_metric["categories"], ["Gas", "Heizöl"])


if __name__ == "__main__":
    unittest.main()
