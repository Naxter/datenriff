import unittest

from zensus_pipeline.special_values import parse_value


class TestSpecialValues(unittest.TestCase):
    def test_missing_tokens_are_none_not_zero(self):
        for token in ("", ".", "..", "…", "/", "x", "X", "k.A."):
            self.assertIsNone(parse_value(token), token)

    def test_nil_dash_is_zero_not_missing(self):
        # Census legend: "– = Genau Null oder auf Null geändert".
        for token in ("-", "–", "—", " – "):
            self.assertEqual(parse_value(token), 0.0, token)

    def test_nil_and_missing_are_not_confused(self):
        # A share must keep the cell whose numerator is nil, and drop the
        # one whose numerator is withheld — that difference is the whole
        # point of the split.
        self.assertEqual(parse_value("–"), 0.0)
        self.assertIsNone(parse_value("."))

    def test_plain_numbers(self):
        self.assertEqual(parse_value("123"), 123.0)
        self.assertEqual(parse_value(" 47 "), 47.0)

    def test_german_decimal_comma(self):
        self.assertEqual(parse_value("44,6"), 44.6)
        self.assertEqual(parse_value("6,04"), 6.04)

    def test_extra_missing_tokens(self):
        self.assertIsNone(parse_value("-1", frozenset({"-1"})))
        self.assertEqual(parse_value("-1"), -1.0)
        self.assertEqual(parse_value("5", frozenset({"-1"})), 5.0)

    def test_extra_missing_can_override_a_nil_token(self):
        self.assertIsNone(parse_value("–", frozenset({"–"})))

    def test_unparseable_is_none(self):
        self.assertIsNone(parse_value("abc"))
        self.assertIsNone(parse_value(None))


if __name__ == "__main__":
    unittest.main()
