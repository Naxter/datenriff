"""CORINE Land Cover classes, grouped for a legible legend.

CLC5 carries the full three-digit CORINE nomenclature — 35 classes occur
in Germany. That is more than a categorical palette can carry, so the
classes are grouped into eight bands that stay meaningful on a map of
Germany: what a viewer can name at a glance.

`ARTIFICIAL` is CORINE level 1 class 1 (codes 111-142), the official
"artificial surfaces". Note that this includes urban green and sport
grounds: a park is artificial land cover, but it is not sealed. The
metric is labelled "artificial surface" for exactly that reason.
"""

from __future__ import annotations

#: (label, codes) in legend order; the index is what the u8 buffer stores
GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Urban fabric", ("111", "112")),
    ("Industry & transport", ("121", "122", "123", "124", "131", "132", "133")),
    ("Urban green & sport", ("141", "142")),
    ("Arable & crops", ("211", "212", "213", "221", "222", "223", "241", "242", "243", "244")),
    ("Pasture", ("231",)),
    ("Forest", ("311", "312", "313")),
    ("Open nature", ("321", "322", "323", "324", "331", "332", "333", "334", "335")),
    ("Water & wetland", ("411", "412", "421", "422", "423", "511", "512", "521", "522", "523")),
)

LABELS: tuple[str, ...] = tuple(label for label, _ in GROUPS)

#: three-digit CLC code -> group index
GROUP_OF_CODE: dict[str, int] = {
    code: index for index, (_, codes) in enumerate(GROUPS) for code in codes
}

#: CORINE level 1 class 1: artificial surfaces
ARTIFICIAL_PREFIX = "1"


def group_index(code: str) -> int:
    """Group index for a CLC code, or -1 if the code is not one we map."""
    return GROUP_OF_CODE.get(code.strip(), -1)


def is_artificial(code: str) -> bool:
    """CORINE level 1 class 1 — artificial surfaces, parks included."""
    return code.strip().startswith(ARTIFICIAL_PREFIX)


#: group indices that make up the artificial share — kept in step with
#: ARTIFICIAL_PREFIX by a test, so regrouping cannot silently change it
ARTIFICIAL_GROUPS: frozenset[int] = frozenset(
    index for index, (_, codes) in enumerate(GROUPS) if all(is_artificial(c) for c in codes)
)
