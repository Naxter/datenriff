import tempfile
import unittest
from pathlib import Path

import numpy as np

from forest import raster


def write_set(directory: Path, country: str, mask, latest, agent, pixel=30.0, origin=(4000000.0, 3000000.0)):
    """Write a matching trio of tiny GeoTIFFs on one grid."""
    import rasterio
    from rasterio.transform import from_origin

    transform = from_origin(origin[0], origin[1], pixel, pixel)
    common = dict(
        driver="GTiff",
        height=mask.shape[0],
        width=mask.shape[1],
        count=1,
        crs="EPSG:3035",
        transform=transform,
    )
    for name, data, dtype in (
        (f"forest_mask_{country}.tif", mask, "uint8"),
        (f"latest_disturbance_{country}.tif", latest, "int16"),
        (f"disturbance_agent_aggregated_{country}.tif", agent, "int16"),
    ):
        with rasterio.open(directory / name, "w", dtype=dtype, **common) as ds:
            ds.write(data.astype(dtype), 1)


class TestBlockSum(unittest.TestCase):
    def test_counts_each_block_separately(self):
        flags = np.array([
            [1, 1, 0, 0],
            [1, 0, 0, 0],
            [0, 0, 1, 1],
            [0, 0, 1, 1],
        ], dtype=bool)
        summed = raster._block_sum(flags, 2)
        self.assertEqual(summed.tolist(), [[3, 0], [0, 4]])

    def test_a_partial_block_at_the_edge_is_dropped(self):
        flags = np.ones((3, 3), dtype=bool)
        summed = raster._block_sum(flags, 2)
        self.assertEqual(summed.shape, (1, 1))
        self.assertEqual(summed[0][0], 4)


class TestReadBlocks(unittest.TestCase):
    def test_it_counts_forest_disturbance_and_cause(self):
        mask = np.array([
            [1, 1, 0, 0],
            [1, 1, 0, 0],
            [1, 1, 1, 1],
            [1, 1, 1, 1],
        ])
        # top-left block: two of four disturbed, one by fire, one by harvest
        latest = np.array([
            [1999, 2005, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ])
        agent = np.array([
            [2, 3, 255, 255],
            [255, 255, 255, 255],
            [255, 255, 255, 255],
            [255, 255, 255, 255],
        ])
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            write_set(d, "testland", mask, latest, agent)
            chunks = list(raster.read_blocks(raster.open_set(d, "testland"), block=2))
        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        # three blocks hold forest; the top-right one holds none
        self.assertEqual(sorted(chunk.forest.tolist()), [4, 4, 4])
        self.assertEqual(int(chunk.disturbed.sum()), 2)
        # one fire, one harvest, nothing else
        self.assertEqual(chunk.agents.sum(axis=0).tolist(), [0, 1, 1, 0])

    def test_only_forest_pixels_count_as_disturbed(self):
        # a disturbed pixel outside the forest mask must not be counted
        mask = np.array([[1, 0], [0, 0]])
        latest = np.array([[0, 2001], [2001, 2001]])
        agent = np.array([[255, 3], [3, 3]])
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            write_set(d, "testland", mask, latest, agent)
            chunks = list(raster.read_blocks(raster.open_set(d, "testland"), block=2))
        self.assertEqual(int(chunks[0].disturbed.sum()), 0)
        self.assertEqual(chunks[0].agents.sum(), 0)

    def test_blocks_do_not_straddle_two_strips(self):
        # 8 rows read in strips of 3 would cut a 2 px block in half; the
        # reader must round the strip down to a whole number of blocks
        mask = np.ones((8, 2))
        latest = np.zeros((8, 2))
        agent = np.full((8, 2), 255)
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            write_set(d, "testland", mask, latest, agent)
            paths = raster.open_set(d, "testland")
            chunks = list(raster.read_blocks(paths, block=2, chunk_rows=3))
        total = sum(int(c.forest.sum()) for c in chunks)
        self.assertEqual(total, 16, "every pixel should be counted exactly once")

    def test_it_refuses_rasters_on_different_grids(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            write_set(d, "testland", np.ones((4, 4)), np.zeros((4, 4)), np.full((4, 4), 255))
            # overwrite one layer with a different size
            import rasterio
            from rasterio.transform import from_origin
            with rasterio.open(
                d / "latest_disturbance_testland.tif", "w", driver="GTiff",
                height=2, width=2, count=1, dtype="int16", crs="EPSG:3035",
                transform=from_origin(4000000.0, 3000000.0, 30.0, 30.0),
            ) as ds:
                ds.write(np.zeros((2, 2), dtype="int16"), 1)
            with self.assertRaises(SystemExit):
                list(raster.read_blocks(raster.open_set(d, "testland"), block=2))

    def test_missing_files_are_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit) as caught:
                raster.open_set(Path(tmp), "nowhere")
        self.assertIn("forest_mask_nowhere.tif", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
