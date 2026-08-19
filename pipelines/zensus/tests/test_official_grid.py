"""Cross-check the 100 m parsing against Destatis' own 1 km table.

The census publishes the vacancy rate on three grids from the same
underlying data. Pooling the 100 m cells of a square kilometre has to land
near the published 1 km figure; if it does not, the 100 m rows are being
read wrong.

That is exactly how the nil-dash bug hid: reading "–" as missing instead of
zero left each square kilometre averaged over only the cells that had any
vacancy at all, a median of 16 percentage points too high. The bound below
separates the two readings by a wide margin — the corrected one sits near
2 pp, the broken one near 16.

The remaining gap is expected: this pools the rates unweighted, while the
published figure weights by dwellings, and every figure carries the
disclosure procedure's noise.

Skipped unless the downloaded source files are present; they are large and
git-ignored, so this runs on a machine that has run the pipeline.
"""

from __future__ import annotations

import csv
import io
import unittest
import zipfile
from collections import defaultdict
from pathlib import Path
from statistics import median

from zensus_pipeline.gridref import parse_grid_id
from zensus_pipeline.special_values import parse_value

DOWNLOADS = Path(__file__).resolve().parents[1] / "downloads"
FINE = DOWNLOADS / "Zensus2022_Leerstandsquote_100m-Gitter.csv"
ARCHIVE = DOWNLOADS / "Leerstandsquote_in_Gitterzellen.zip"
COARSE_MEMBER = "Zensus2022_Leerstandsquote_1km-Gitter.csv"
VALUE_COLUMN = "Leerstandsquote"

# Percentage points. The corrected reading lands around 2.4, the broken one
# around 16.5, so this is a wide fence around a large difference.
MAX_MEDIAN_ERROR_PP = 5.0


def _block_of(grid_id: str) -> tuple[int, int]:
    """The 1 km block a finer cell falls into, keyed by its lower-left corner."""
    cell = parse_grid_id(grid_id)
    return cell.north // 1000, cell.east // 1000


def _read_official_blocks() -> dict[tuple[int, int], float]:
    with zipfile.ZipFile(ARCHIVE) as archive:
        with archive.open(COARSE_MEMBER) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            reader = csv.DictReader(text, delimiter=";")
            id_column = reader.fieldnames[0]
            blocks = {}
            for row in reader:
                value = parse_value(row[VALUE_COLUMN])
                if value is None:
                    continue
                cell = parse_grid_id(row[id_column])
                blocks[(cell.north // 1000, cell.east // 1000)] = value
    return blocks


def _pool_fine_cells() -> dict[tuple[int, int], tuple[float, int]]:
    pooled: dict[tuple[int, int], list[float]] = defaultdict(lambda: [0.0, 0])
    with FINE.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        id_column = reader.fieldnames[0]
        for row in reader:
            value = parse_value(row[VALUE_COLUMN])
            if value is None:
                continue
            entry = pooled[_block_of(row[id_column])]
            entry[0] += value
            entry[1] += 1
    return {block: (total, count) for block, (total, count) in pooled.items()}


@unittest.skipUnless(
    FINE.exists() and ARCHIVE.exists(),
    f"census downloads not present in {DOWNLOADS}",
)
class TestAgainstOfficialCoarseGrid(unittest.TestCase):
    def test_pooled_100m_cells_match_the_published_1km_rate(self):
        official = _read_official_blocks()
        pooled = _pool_fine_cells()
        self.assertGreater(len(official), 10_000, "official 1 km table looks short")

        errors = []
        for block, rate in official.items():
            if block not in pooled:
                continue
            total, count = pooled[block]
            errors.append(abs(total / count - rate))

        self.assertGreater(len(errors), 10_000, "too few blocks overlap to judge")
        self.assertLess(
            median(errors),
            MAX_MEDIAN_ERROR_PP,
            "pooled 100 m cells drifted from the published 1 km rate; "
            "check how nil and withheld markers are parsed",
        )

    def test_nil_cells_are_the_majority_and_carry_zero(self):
        # If this ever stops holding, the fixture changed and the bound
        # above stops meaning anything.
        nil = numeric = 0
        with FINE.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter=";")
            for row in reader:
                raw = row[VALUE_COLUMN].strip()
                if raw in {"-", "–", "—"}:
                    nil += 1
                    self.assertEqual(parse_value(raw), 0.0)
                else:
                    numeric += 1
        self.assertGreater(nil, numeric, "expected most cells to report no vacancy")


if __name__ == "__main__":
    unittest.main()
