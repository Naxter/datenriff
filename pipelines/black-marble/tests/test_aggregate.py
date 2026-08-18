"""Aggregation rules for night-light intensities (stdlib only)."""

import unittest

from blackmarble.aggregate import (
    accumulate_mean,
    aggregate_mean_to_parent,
    relative_change,
)


class TestAccumulateMean(unittest.TestCase):
    def test_mean_not_sum(self):
        # radiance is an intensity: two pixels of 30 average to 30, not 60
        means, counts = accumulate_mean([("a", 30.0), ("a", 30.0), ("b", 10.0)])
        self.assertEqual(means["a"], 30.0)
        self.assertEqual(counts["a"], 2)
        self.assertEqual(means["b"], 10.0)

    def test_missing_pixels_are_skipped(self):
        means, counts = accumulate_mean([("a", None), ("a", 8.0)])
        self.assertEqual(means["a"], 8.0)
        self.assertEqual(counts["a"], 1)

    def test_all_missing_yields_no_cell(self):
        means, counts = accumulate_mean([("a", None)])
        self.assertEqual(means, {})
        self.assertEqual(counts, {})


class TestAggregateToParent(unittest.TestCase):
    def test_weighted_by_sample_count(self):
        # a: 3 px at 10, b: 1 px at 50 → parent mean = (30 + 50) / 4 = 20
        means = {"a": 10.0, "b": 50.0}
        counts = {"a": 3, "b": 1}
        parents, weights = aggregate_mean_to_parent(means, counts, lambda c: "p")
        self.assertAlmostEqual(parents["p"], 20.0)
        self.assertEqual(weights["p"], 4)

    def test_not_mean_of_means(self):
        means = {"a": 10.0, "b": 50.0}
        counts = {"a": 9, "b": 1}
        parents, _ = aggregate_mean_to_parent(means, counts, lambda c: "p")
        self.assertAlmostEqual(parents["p"], 14.0)
        self.assertNotAlmostEqual(parents["p"], 30.0, msg="mean of means is wrong")

    def test_zero_weight_children_are_ignored(self):
        parents, weights = aggregate_mean_to_parent(
            {"a": 10.0, "b": 99.0}, {"a": 2, "b": 0}, lambda c: "p"
        )
        self.assertAlmostEqual(parents["p"], 10.0)
        self.assertEqual(weights["p"], 2)


class TestRelativeChange(unittest.TestCase):
    def test_change_against_baseline(self):
        out = relative_change({"a": 15.0}, {"a": 10.0})
        self.assertAlmostEqual(out["a"], 0.5)

    def test_dark_baseline_is_suppressed(self):
        out = relative_change({"a": 5.0}, {"a": 0.1}, min_baseline=0.5)
        self.assertIsNone(out["a"], "a dark baseline makes the ratio meaningless")

    def test_missing_sides_are_suppressed(self):
        out = relative_change({"a": 5.0, "b": None}, {"a": None, "b": 3.0})
        self.assertIsNone(out["a"])
        self.assertIsNone(out["b"])


if __name__ == "__main__":
    unittest.main()
