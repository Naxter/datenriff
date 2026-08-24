import tempfile
import unittest
from pathlib import Path

from zensus_pipeline.provenance import hash_of, provenance, sha256_of


class TestHashOf(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name: str, text: str) -> Path:
        path = self.dir / name
        path.write_text(text, encoding="utf-8")
        return path

    def test_no_inputs_is_none_not_a_hash_of_nothing(self):
        # A pipeline that read nothing from disk must say so, so the gap is
        # visible rather than filled with the digest of an empty set.
        self.assertIsNone(hash_of([]))

    def test_one_file_is_that_file_s_own_digest(self):
        # Keeps hashes recorded before this module comparable.
        path = self.write("a.txt", "hello")
        self.assertEqual(hash_of([path]), f"sha256:{sha256_of(path)}")

    def test_order_does_not_change_the_answer(self):
        a = self.write("a.txt", "one")
        b = self.write("b.txt", "two")
        self.assertEqual(hash_of([a, b]), hash_of([b, a]))

    def test_changed_contents_change_the_hash(self):
        a = self.write("a.txt", "one")
        b = self.write("b.txt", "two")
        before = hash_of([a, b])
        b.write_text("two, revised", encoding="utf-8")
        self.assertNotEqual(before, hash_of([a, b]))

    def test_a_rename_changes_the_hash(self):
        # Names carry meaning here: a year per grid, a tile per raster.
        a = self.write("2001.asc", "same")
        before = hash_of([a, self.write("2002.asc", "other")])
        a.rename(self.dir / "2003.asc")
        after = hash_of([self.dir / "2003.asc", self.dir / "2002.asc"])
        self.assertNotEqual(before, after)

    def test_missing_paths_are_skipped_not_fatal(self):
        a = self.write("a.txt", "one")
        self.assertEqual(hash_of([a, self.dir / "gone.txt"]), hash_of([a]))


class TestProvenance(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_directory_is_searched(self):
        (self.dir / "sub").mkdir()
        (self.dir / "sub" / "grid.asc").write_text("x", encoding="utf-8")
        (self.dir / "top.asc").write_text("y", encoding="utf-8")
        block = provenance(
            source_url="https://example.invalid/",
            pipeline_version="test 0.0.0",
            inputs=self.dir,
        )
        self.assertEqual(block["sourceFiles"], 2)
        self.assertTrue(block["sourceHash"].startswith("sha256:"))

    def test_every_field_the_manifest_expects_is_present(self):
        block = provenance(
            source_url="https://example.invalid/",
            pipeline_version="test 0.0.0",
            download_date="2026-08-24",
        )
        for key in (
            "sourceUrl",
            "sourceHash",
            "downloadDate",
            "pipelineVersion",
            "gitCommit",
            "generatedAt",
        ):
            self.assertIn(key, block)
        self.assertEqual(block["downloadDate"], "2026-08-24")
        # nothing on disk to hash, and the block says so instead of guessing
        self.assertIsNone(block["sourceHash"])

    def test_generated_at_is_utc_with_a_z(self):
        block = provenance(source_url="u", pipeline_version="v")
        self.assertTrue(block["generatedAt"].endswith("Z"), block["generatedAt"])


if __name__ == "__main__":
    unittest.main()
