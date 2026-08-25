"""CLC5: GeoPackage/WKB reading, class grouping and H3 coverage.

Everything runs against a GeoPackage built here, so the tests need no
download and no GDAL: a GeoPackage is a SQLite file, and writing the two
metadata tables plus one feature table is enough for the reader.
"""


from __future__ import annotations

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

_skip_without('numpy')

import json
import sqlite3
import struct
import tempfile
import unittest
from pathlib import Path

from clc5 import classes, gpkg

try:  # the coverage step needs h3, numpy and pyproj
    import h3  # noqa: F401
    import numpy  # noqa: F401
    import pyproj  # noqa: F401

    HAVE_GEO = True
except ImportError:  # pragma: no cover
    HAVE_GEO = False

needs_geo = unittest.skipUnless(HAVE_GEO, "h3/numpy/pyproj not installed")


def wkb_polygon(rings, endian="<"):
    """A WKB polygon (type 3) from [[(x, y), ...], ...]."""
    order = 1 if endian == "<" else 0
    out = struct.pack(f"{endian}BI", order, 3) + struct.pack(f"{endian}I", len(rings))
    for ring in rings:
        out += struct.pack(f"{endian}I", len(ring))
        for x, y in ring:
            out += struct.pack(f"{endian}dd", x, y)
    return out


def wkb_multipolygon(polygons, endian="<"):
    order = 1 if endian == "<" else 0
    out = struct.pack(f"{endian}BI", order, 6) + struct.pack(f"{endian}I", len(polygons))
    for rings in polygons:
        out += wkb_polygon(rings, endian)
    return out


def gpkg_blob(wkb: bytes, srs_id: int = 25832, envelope: bool = False) -> bytes:
    """Wrap WKB in a GeoPackage geometry blob header."""
    flags = 0x01 | (0x02 if envelope else 0x00)  # little-endian header
    head = b"GP" + bytes([0, flags]) + struct.pack("<i", srs_id)
    if envelope:
        head += struct.pack("<4d", 0.0, 1.0, 0.0, 1.0)
    return head + wkb


def write_gpkg(path: Path, rows, table="clc5ha_2021", attribute="CLC21"):
    """A minimal GeoPackage: gpkg_contents, gpkg_geometry_columns, features."""
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE gpkg_contents (table_name TEXT, data_type TEXT, srs_id INTEGER)")
    db.execute(
        "CREATE TABLE gpkg_geometry_columns "
        "(table_name TEXT, column_name TEXT, geometry_type_name TEXT, srs_id INTEGER)"
    )
    db.execute("INSERT INTO gpkg_contents VALUES (?, 'features', 25832)", (table,))
    db.execute(
        "INSERT INTO gpkg_geometry_columns VALUES (?, 'Shape', 'MULTIPOLYGON', 25832)", (table,)
    )
    db.execute(f'CREATE TABLE "{table}" (OBJECTID INTEGER, "{attribute}" TEXT, Shape BLOB)')
    for i, (code, blob) in enumerate(rows, 1):
        db.execute(f'INSERT INTO "{table}" VALUES (?, ?, ?)', (i, code, blob))
    db.commit()
    db.close()


class TestClasses(unittest.TestCase):
    def test_every_group_code_is_three_digits_and_unique(self):
        seen: set[str] = set()
        for _, codes in classes.GROUPS:
            for code in codes:
                self.assertRegex(code, r"^\d{3}$")
                self.assertNotIn(code, seen, f"{code} is in two groups")
                seen.add(code)

    def test_artificial_groups_agree_with_the_corine_level_1_rule(self):
        """The share is summed over whole groups, so a group must be either
        entirely artificial or not artificial at all."""
        for code, group in classes.GROUP_OF_CODE.items():
            self.assertEqual(
                classes.is_artificial(code),
                group in classes.ARTIFICIAL_GROUPS,
                f"{code} ({classes.LABELS[group]}) falls on both sides",
            )
        self.assertEqual(
            [classes.LABELS[i] for i in sorted(classes.ARTIFICIAL_GROUPS)],
            ["Urban fabric", "Industry & transport", "Urban green & sport"],
        )

    def test_unknown_code(self):
        self.assertEqual(classes.group_index("999"), -1)
        self.assertEqual(classes.group_index(" 311 "), classes.GROUP_OF_CODE["311"])


class TestGeoPackageReader(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "test.gpkg"

    def tearDown(self):
        self.tmp.cleanup()

    def test_reads_a_multipolygon_with_a_hole(self):
        square = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0)]
        hole = [(4.0, 4.0), (6.0, 4.0), (6.0, 6.0), (4.0, 6.0), (4.0, 4.0)]
        blob = gpkg_blob(wkb_multipolygon([[square, hole]]))
        write_gpkg(self.path, [("112", blob)])
        got = list(gpkg.read_features(self.path, "clc5ha_2021", "CLC21"))
        self.assertEqual(len(got), 1)
        code, polygons = got[0]
        self.assertEqual(code, "112")
        self.assertEqual(len(polygons), 1)
        rings = polygons[0]
        self.assertEqual(len(rings), 2, "outer ring plus the hole")
        self.assertEqual(rings[0].shape, (5, 2))
        self.assertEqual(rings[1].shape, (5, 2))
        self.assertAlmostEqual(float(rings[0][2][0]), 10.0)

    def test_reads_a_plain_polygon_too(self):
        square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 0.0)]
        write_gpkg(self.path, [("311", gpkg_blob(wkb_polygon(square and [square])))])
        (code, polygons), = gpkg.read_features(self.path, "clc5ha_2021", "CLC21")
        self.assertEqual(code, "311")
        self.assertEqual(polygons[0][0].shape, (4, 2))

    def test_envelope_in_the_header_is_skipped(self):
        square = [[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 0.0)]]
        write_gpkg(self.path, [("211", gpkg_blob(wkb_polygon(square), envelope=True))])
        (_, polygons), = gpkg.read_features(self.path, "clc5ha_2021", "CLC21")
        self.assertEqual(polygons[0][0].shape, (4, 2))

    def test_big_endian_wkb(self):
        square = [[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 0.0)]]
        write_gpkg(self.path, [("211", gpkg_blob(wkb_polygon(square, endian=">")))])
        (_, polygons), = gpkg.read_features(self.path, "clc5ha_2021", "CLC21")
        self.assertAlmostEqual(float(polygons[0][0][1][0]), 1.0)

    def test_a_blob_that_is_not_a_geopackage_geometry_is_an_error(self):
        with self.assertRaises(ValueError):
            gpkg.strip_header(b"XX" + bytes(20))

    def test_unsupported_geometry_type(self):
        point = struct.pack("<BI", 1, 1) + struct.pack("<dd", 1.0, 2.0)
        with self.assertRaises(ValueError):
            gpkg.parse_wkb_polygons(memoryview(point))


@needs_geo
class TestCoverage(unittest.TestCase):
    """A square kilometre near Kassel, in UTM32, covered at r10."""

    #: a 2 km x 2 km block, EPSG:25832
    BLOCK = [(535000.0, 5680000.0), (537000.0, 5680000.0),
             (537000.0, 5682000.0), (535000.0, 5682000.0), (535000.0, 5680000.0)]

    def cells_of(self, ring, res=10):
        import numpy as np

        from clc5 import coverage

        tr = coverage.transformer("EPSG:25832")
        rings = coverage.rings_to_latlng([np.array(ring, dtype="float64")], tr)
        return coverage.polygon_cells(rings, res)

    def test_a_2km_block_covers_a_plausible_number_of_r10_cells(self):
        cells = self.cells_of(self.BLOCK)
        # 4 km2 / 0.015 km2 per r10 cell, and the count must be in that region
        self.assertGreater(len(cells), 180)
        self.assertLess(len(cells), 400)

    def test_the_cells_land_where_the_block_is(self):
        import h3

        for cell in list(self.cells_of(self.BLOCK))[:20]:
            lat, lng = h3.cell_to_latlng(cell)
            self.assertTrue(50.9 < lat < 51.4, lat)
            self.assertTrue(9.0 < lng < 9.8, lng)

    def test_a_hole_removes_cells(self):
        import numpy as np

        from clc5 import coverage

        hole = [(535500.0, 5680500.0), (536500.0, 5680500.0),
                (536500.0, 5681500.0), (535500.0, 5681500.0), (535500.0, 5680500.0)]
        tr = coverage.transformer("EPSG:25832")
        rings = coverage.rings_to_latlng(
            [np.array(self.BLOCK, dtype="float64"), np.array(hole, dtype="float64")], tr
        )
        with_hole = coverage.polygon_cells(rings)
        self.assertLess(len(with_hole), len(self.cells_of(self.BLOCK)))

    def test_shares_and_dominance(self):
        import numpy as np

        from clc5 import coverage

        row = np.zeros(len(classes.LABELS), dtype="int32")
        row[0] = 10   # urban fabric   (artificial)
        row[1] = 10   # industry       (artificial)
        row[5] = 30   # forest
        share, dominant, strength = coverage.shares(row, classes.ARTIFICIAL_GROUPS)
        self.assertAlmostEqual(share, 0.4, msg="a fraction, not a percentage")
        self.assertEqual(dominant, 5)
        self.assertAlmostEqual(strength, 0.6)

    def test_an_empty_cell_reports_missing(self):
        import numpy as np

        from clc5 import coverage

        share, dominant, strength = coverage.shares(
            np.zeros(len(classes.LABELS), dtype="int32"), classes.ARTIFICIAL_GROUPS
        )
        self.assertTrue(np.isnan(share))
        self.assertEqual(dominant, -1)


@needs_geo
class TestPipeline(unittest.TestCase):
    BLOCK = [(535000.0, 5680000.0), (537000.0, 5680000.0),
             (537000.0, 5682000.0), (535000.0, 5682000.0), (535000.0, 5680000.0)]

    def run_pipeline(self, tmp: Path, gap: float):
        """Two 2 km blocks, urban and forest, `gap` metres apart."""
        from clc5 import pipeline

        west = list(self.BLOCK)
        east = [(x + 2000.0 + gap, y) for x, y in self.BLOCK]
        src = tmp / "clc5.gpkg"
        write_gpkg(src, [
            ("112", gpkg_blob(wkb_multipolygon([[west]]))),
            ("312", gpkg_blob(wkb_multipolygon([[east]]))),
        ])
        out = tmp / "out"
        pipeline.main([
            "--input", str(src), "--year", "2021", "--out", str(out),
            "--resolutions", "8,7", "--tiled", "8",
            # BKG's source note carries the year of the last download, so the
            # pipeline refuses to guess one
            "--download-date", "2026-08-19",
        ])
        cells = (out / "r8" / "cells.txt").read_text().split()
        share = struct.unpack(
            f"<{len(cells)}f", (out / "r8" / "built_share_2021.f32").read_bytes()
        )
        klass = (out / "r8" / "land_class_2021.u8").read_bytes()
        return out, cells, share, klass

    def test_separated_blocks_are_wholly_one_class_or_the_other(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, cells, share, klass = self.run_pipeline(Path(tmp), gap=10_000.0)
            self.assertEqual({round(v) for v in share}, {0, 1})
            self.assertEqual(set(klass) - {255}, {0, 5})
            for value, category in zip(share, klass):
                self.assertEqual(round(value) == 1, category == 0,
                                 "urban cells are the artificial ones")

            manifest = json.loads((out / "dataset.json").read_text(encoding="utf-8"))
            ids = [m["id"] for m in manifest["metrics"]]
            self.assertEqual(
                ids, ["built_share_2021", "land_class_2021", "land_class_dominance_2021"]
            )
            categories = next(m for m in manifest["metrics"] if m["id"] == "land_class_2021")
            self.assertEqual(categories["categories"], list(classes.LABELS))
            self.assertEqual(categories["aggregation"], "categoricalDominant")
            lods = {lod["resolution"]: lod for lod in manifest["lods"]}
            self.assertIn("tileIndex", lods[8])
            self.assertNotIn("tileIndex", lods[7])
            index = json.loads((out / "r8" / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(sum(t["count"] for t in index["tiles"]), len(cells))
            self.assertLess(lods[7]["count"], lods[8]["count"], "r7 pools r8")

    def test_a_second_vintage_shares_the_first_universe(self):
        """Two years of the same dataset must line up cell for cell, and a
        cell the second year does not cover is missing, not zero built."""
        import math

        from clc5 import pipeline

        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            out, cells, _, _ = self.run_pipeline(tmp, gap=10_000.0)
            first = (out / "r8" / "cells.txt").read_text()

            # a second vintage covering only the western block
            src = tmp / "clc5_2012.gpkg"
            write_gpkg(src, [("112", gpkg_blob(wkb_multipolygon([[list(self.BLOCK)]])))])
            pipeline.main([
                "--input", str(src), "--year", "2012", "--out", str(out),
                "--resolutions", "8,7", "--tiled", "8",
                "--download-date", "2026-08-19",
            ])

            self.assertEqual((out / "r8" / "cells.txt").read_text(), first, "universe is fixed")
            n = len(cells)
            older = struct.unpack(
                f"<{n}f", (out / "r8" / "built_share_2012.f32").read_bytes()
            )
            self.assertEqual(len(older), n, "both vintages have the same length")
            self.assertTrue(any(math.isnan(v) for v in older), "uncovered cells are missing")
            self.assertTrue(any(v == 1.0 for v in older), "the covered block is still built")

            manifest = json.loads((out / "dataset.json").read_text(encoding="utf-8"))
            ids = {m["id"] for m in manifest["metrics"]}
            self.assertIn("built_share_2012", ids)
            self.assertIn("built_share_2021", ids)

    def test_a_cell_on_the_seam_reports_a_partial_share(self):
        """The share is an area fraction, not a flag: a cell that is part
        urban and part forest must land strictly between 0 and 100."""
        with tempfile.TemporaryDirectory() as tmp:
            _, _, share, klass = self.run_pipeline(Path(tmp), gap=0.0)
            mixed = [v for v in share if 0.005 < v < 0.995]
            self.assertTrue(mixed, "no cell straddles the two blocks")
            self.assertTrue(all(0.0 <= v <= 1.0 for v in share))
            self.assertEqual(set(klass) - {255}, {0, 5}, "the dominant class is still one of two")


try:  # the converter is a tool, not part of the pipeline
    import pyogrio  # noqa: F401

    HAVE_PYOGRIO = True
except ImportError:  # pragma: no cover
    HAVE_PYOGRIO = False


@unittest.skipUnless(HAVE_PYOGRIO, "pyogrio not installed")
class TestShapefileConversion(unittest.TestCase):
    """The older vintages are shapefiles. They are converted once instead of
    parsed, so what this checks is that the converted file is something
    gpkg.py reads back unchanged — holes included, since a shapefile marks
    them by winding direction and WKB by position."""

    def write_shapefile(self, path: Path):
        import numpy as np
        from pyogrio.raw import write

        square = [(0.0, 0.0), (2000.0, 0.0), (2000.0, 2000.0), (0.0, 2000.0), (0.0, 0.0)]
        hole = [(500.0, 500.0), (500.0, 1500.0), (1500.0, 1500.0), (1500.0, 500.0), (500.0, 500.0)]
        far = [(x + 9000.0, y) for x, y in square]
        geoms = np.array(
            [wkb_polygon([square, hole]), wkb_polygon([far])], dtype=object
        )
        write(
            str(path), geoms, [np.array(["112", "312"], dtype=object)], ["CLC12"],
            driver="ESRI Shapefile", geometry_type="Polygon", crs="EPSG:25832",
        )

    def test_converted_file_reads_back_with_its_hole(self):
        from clc5 import convert

        with tempfile.TemporaryDirectory() as tmp:
            shp = Path(tmp) / "clc5_2012.shp"
            gpkg_path = Path(tmp) / "clc5_2012.gpkg"
            self.write_shapefile(shp)
            count = convert.convert(shp, gpkg_path, layer="clc5", chunk=1)
            self.assertEqual(count, 2, "chunking must not drop or repeat features")

            rows = dict(gpkg.read_features(gpkg_path, "clc5", "CLC12"))
            self.assertEqual(sorted(rows), ["112", "312"])
            rings = rows["112"][0]
            self.assertEqual(len(rings), 2, "the hole survives as a second ring")
            outer, inner = rings
            self.assertGreater(
                abs(shoelace(outer)), abs(shoelace(inner)), "ring 0 is the outer one"
            )

    def test_it_refuses_to_append_to_an_existing_file(self):
        from clc5 import convert

        with tempfile.TemporaryDirectory() as tmp:
            shp = Path(tmp) / "clc5_2012.shp"
            out = Path(tmp) / "out.gpkg"
            self.write_shapefile(shp)
            convert.convert(shp, out, layer="clc5")
            with self.assertRaises(SystemExit):
                convert.convert(shp, out, layer="clc5")


def shoelace(ring) -> float:
    """Signed area of a ring; the sign tells outer from hole in a shapefile."""
    import numpy as np

    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * float((x * np.roll(y, -1) - y * np.roll(x, -1)).sum())


if __name__ == "__main__":
    unittest.main()
