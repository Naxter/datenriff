"""Where a dataset came from, recorded the same way by every pipeline.

Six pipelines each wrote their own `git_commit`, their own timestamp
formatting, and their own idea of whether the source could be hashed — four
of them settled on ``"sourceHash": None``. A map whose source cannot be
identified cannot be reproduced or corrected, and "which file produced this?"
is the first question anyone asks of a number they doubt.

Every pipeline calls :func:`provenance` and gets the same shape.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import subprocess
from pathlib import Path
from typing import Iterable

__all__ = ["sha256_of", "hash_of", "git_commit", "utc_now", "provenance"]

# Read in blocks: the census archives and the night-light rasters are
# gigabytes, and hashing must not depend on holding one in memory.
_BLOCK = 1 << 20


def sha256_of(path: Path) -> str:
    """Hex digest of one file's contents."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(_BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()


def hash_of(paths: Iterable[Path]) -> str | None:
    """A digest over a set of inputs, or ``None`` if there are none.

    Several pipelines read a directory rather than one file — a year per
    grid, a tile per raster. Names go into the digest alongside contents and
    the order is sorted, so the same inputs give the same answer however the
    directory happened to be listed, and a renamed file is a different set.

    A single file still returns that file's own digest, so a hash recorded
    before this existed stays comparable.
    """
    files = sorted({Path(p) for p in paths if Path(p).is_file()})
    if not files:
        return None
    if len(files) == 1:
        return f"sha256:{sha256_of(files[0])}"
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(sha256_of(path).encode("ascii"))
        digest.update(b"\n")
    return f"sha256:{digest.hexdigest()}"


def _expand(inputs: Iterable[Path] | Path | None) -> list[Path]:
    """A file, a directory (searched), or several of either."""
    if inputs is None:
        return []
    candidates = [inputs] if isinstance(inputs, (str, Path)) else list(inputs)
    found: list[Path] = []
    for entry in candidates:
        path = Path(entry)
        if path.is_dir():
            found.extend(p for p in path.rglob("*") if p.is_file())
        elif path.is_file():
            found.append(path)
    return found


def git_commit() -> str | None:
    """Short commit of the working tree, or ``None`` outside a repository."""
    try:
        return (
            subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            or None
        )
    except (OSError, subprocess.CalledProcessError):
        return None


def utc_now() -> str:
    """Second-precision UTC, the form already in every dataset manifest."""
    return (
        _dt.datetime.now(_dt.timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def provenance(
    *,
    source_url: str,
    pipeline_version: str,
    inputs: Iterable[Path] | Path | None = None,
    download_date: str | None = None,
) -> dict:
    """The provenance block for a dataset manifest.

    `inputs` may be a file, a directory, or several — whatever this run
    actually read. Hashing is best-effort: a source fetched straight from the
    network with nothing kept on disk leaves ``sourceHash`` null, and
    ``scripts/check-provenance.mjs`` reports that rather than the pipeline
    inventing a value.
    """
    files = _expand(inputs)
    return {
        "sourceUrl": source_url,
        "sourceHash": hash_of(files),
        "sourceFiles": len(files) or None,
        "downloadDate": download_date or _dt.date.today().isoformat(),
        "pipelineVersion": pipeline_version,
        "gitCommit": git_commit(),
        "generatedAt": utc_now(),
    }
