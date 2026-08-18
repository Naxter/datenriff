import unittest

from zensus_pipeline.gridref import (
    find_centre_columns,
    find_grid_id_column,
    parse_grid_id,
)


class TestGridRef(unittest.TestCase):
    def test_parses_100m_id(self):
        cell = parse_grid_id("CRS3035RES100mN2691700E4341100")
        self.assertEqual(cell.resolution_m, 100)
        self.assertEqual(cell.north, 2691700)
        self.assertEqual(cell.east, 4341100)

    def test_centroid_is_lower_left_plus_half(self):
        cell = parse_grid_id("CRS3035RES100mN2691700E4341100")
        self.assertEqual(cell.centroid, (4341150.0, 2691750.0))

    def test_parses_1km_and_10km_ids(self):
        self.assertEqual(parse_grid_id("CRS3035RES1000mN2691000E4341000").resolution_m, 1000)
        self.assertEqual(parse_grid_id("CRS3035RES10000mN2690000E4340000").resolution_m, 10000)

    def test_rejects_garbage(self):
        for bad in ("", "100mN1E1", "CRS3035RES100mN12E", "CRS25832RES100mN1E1"):
            with self.assertRaises(ValueError):
                parse_grid_id(bad)

    def test_finds_grid_id_column_across_releases(self):
        self.assertEqual(
            find_grid_id_column(["GITTER_ID_100m", "Einwohner"]), "GITTER_ID_100m"
        )
        self.assertEqual(
            find_grid_id_column(["Gitter_ID_100m", "Einwohner"]), "Gitter_ID_100m"
        )
        self.assertIsNone(find_grid_id_column(["id", "Einwohner"]))

    def test_finds_centre_columns(self):
        self.assertEqual(
            find_centre_columns(["GITTER_ID_100m", "x_mp_100m", "y_mp_100m", "Einwohner"]),
            ("x_mp_100m", "y_mp_100m"),
        )
        self.assertIsNone(find_centre_columns(["GITTER_ID_100m", "Einwohner"]))


if __name__ == "__main__":
    unittest.main()
