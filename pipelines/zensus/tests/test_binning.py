import unittest

from zensus_pipeline.binning import (
    accumulate_categories,
    accumulate_share,
    accumulate_sum,
    accumulate_weighted,
    batched_cells,
)


def fake_cell_of_batch(xs, ys):
    # cell id from coarse buckets, mimicking an H3 lookup
    return [f"cell_{int(x // 100)}_{int(y // 100)}" for x, y in zip(xs, ys)]


class TestBatchedCells(unittest.TestCase):
    def test_batches_and_flushes_remainder(self):
        rows = [(i, 0, {"v": i}) for i in range(250)]
        out = list(batched_cells(rows, fake_cell_of_batch, batch_size=100))
        self.assertEqual(len(out), 250)
        self.assertEqual(out[0][0], "cell_0_0")
        self.assertEqual(out[249][0], "cell_2_0")
        self.assertEqual(out[249][1], {"v": 249})


class TestAccumulators(unittest.TestCase):
    def test_sum_skips_missing(self):
        pairs = [("a", {"v": 5}), ("a", {"v": None}), ("b", {"v": 7}), ("a", {"v": 3})]
        self.assertEqual(accumulate_sum(pairs, "v"), {"a": 8, "b": 7})

    def test_share_keeps_the_denominator_of_a_zero_numerator(self):
        # Three cells of 100 homes, one of which has 20 new ones: 20/300.
        # Reading the two nil cells as missing would drop their 200 homes
        # from the denominator and report 20/100 — the bug this guards.
        pairs = [
            ("a", {"n": 20.0, "d": 100.0}),
            ("a", {"n": 0.0, "d": 100.0}),
            ("a", {"n": 0.0, "d": 100.0}),
        ]
        num, den = accumulate_share(pairs, "n", "d")
        self.assertEqual(num["a"], 20.0)
        self.assertEqual(den["a"], 300.0)

    def test_share_drops_a_withheld_numerator(self):
        # None means the number is unknown, so the cell cannot be counted
        # either way — neither part enters the pool.
        pairs = [("a", {"n": 20.0, "d": 100.0}), ("a", {"n": None, "d": 100.0})]
        num, den = accumulate_share(pairs, "n", "d")
        self.assertEqual(num["a"], 20.0)
        self.assertEqual(den["a"], 100.0)

    def test_weighted_mean_and_weights(self):
        pairs = [
            ("a", {"v": 40.0, "w": 100}),
            ("a", {"v": 60.0, "w": 300}),
            ("a", {"v": 99.0, "w": None}),
            ("b", {"v": 50.0, "w": 0}),
        ]
        means, weights = accumulate_weighted(pairs, "v", "w")
        self.assertAlmostEqual(means["a"], (40 * 100 + 60 * 300) / 400)
        self.assertEqual(weights["a"], 400)
        self.assertNotIn("b", means, "zero weight contributes nothing")

    def test_categories_counts_by_index(self):
        pairs = [
            ("a", {"gas": 10, "oil": 2, "dh": None}),
            ("a", {"gas": 5, "oil": 0, "dh": 3}),
            ("b", {"gas": None, "oil": None, "dh": None}),
        ]
        result = accumulate_categories(pairs, ["gas", "oil", "dh"])
        self.assertEqual(result["a"], {0: 15, 1: 2, 2: 3})
        self.assertNotIn("b", result, "all-missing cells are dropped")


if __name__ == "__main__":
    unittest.main()
