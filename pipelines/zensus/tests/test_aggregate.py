import unittest

from zensus_pipeline.aggregate import (
    aggregate_categories_to_parent,
    aggregate_sum_to_parent,
    aggregate_weighted_mean_to_parent,
    categorical_dominant,
    change_pct,
    share,
    sum_values,
    weighted_mean,
)


class TestRules(unittest.TestCase):
    def test_sum_skips_missing_but_all_missing_is_none(self):
        self.assertEqual(sum_values([1, None, 2]), 3)
        self.assertIsNone(sum_values([None, None]))

    def test_weighted_mean_is_not_mean_of_means(self):
        # Two cells: age 40 (1000 people), age 60 (10 people).
        result = weighted_mean([(40, 1000), (60, 10)])
        self.assertAlmostEqual(result, (40 * 1000 + 60 * 10) / 1010)
        self.assertNotAlmostEqual(result, 50)

    def test_weighted_mean_missing_and_empty(self):
        self.assertIsNone(weighted_mean([]))
        self.assertIsNone(weighted_mean([(40, None), (None, 10), (40, 0)]))

    def test_share_pools_numerators_and_denominators(self):
        # 10 % of 1000 and 100 % of 10 is NOT 55 %.
        result = share([(100, 1000), (10, 10)])
        self.assertAlmostEqual(result, 110 / 1010)

    def test_share_small_denominator_suppressed(self):
        self.assertIsNone(share([(1, 3)], min_denominator=10))

    def test_categorical_dominant_and_dominance(self):
        result = categorical_dominant({0: 70, 1: 20, 2: 10})
        self.assertEqual(result, (0, 0.7))
        self.assertIsNone(categorical_dominant({}))
        self.assertIsNone(categorical_dominant({0: 0}))

    def test_change_pct_suppresses_small_base(self):
        self.assertAlmostEqual(change_pct(110, 100), 0.1)
        self.assertIsNone(change_pct(110, 10, min_denominator=25))
        self.assertIsNone(change_pct(None, 100))


PARENT = {"a1": "A", "a2": "A", "b1": "B"}


class TestParentAggregation(unittest.TestCase):
    def test_sum_to_parent(self):
        result = aggregate_sum_to_parent(
            {"a1": 5, "a2": None, "b1": 7}, PARENT.__getitem__
        )
        self.assertEqual(result, {"A": 5, "B": 7})

    def test_weighted_mean_to_parent(self):
        result = aggregate_weighted_mean_to_parent(
            {"a1": 10.0, "a2": 20.0, "b1": 5.0},
            {"a1": 1, "a2": 3, "b1": 0},
            PARENT.__getitem__,
        )
        self.assertAlmostEqual(result["A"], (10 * 1 + 20 * 3) / 4)
        self.assertIsNone(result["B"])

    def test_categories_to_parent(self):
        result = aggregate_categories_to_parent(
            {"a1": {0: 60, 1: 40}, "a2": {1: 100}, "b1": {2: 1}},
            PARENT.__getitem__,
        )
        category, dominance = result["A"]
        self.assertEqual(category, 1)
        self.assertAlmostEqual(dominance, 140 / 200)
        self.assertEqual(result["B"], (2, 1.0))


if __name__ == "__main__":
    unittest.main()
