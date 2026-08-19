"""Pull only the layers we read out of the atlas' country archive.

`germany.zip` is 3.1 GB and holds nine layers; this pipeline reads three of
them, together a few percent of that. Zenodo serves byte ranges, so the zip
can be opened where it lies: read the central directory from the tail, then
fetch just those members. That turns a download measured in hours into one
measured in minutes.

The zip reading itself is the MaStR pipeline's `remotezip`, which exists for
the same reason at a larger scale.

    PYTHONPATH=".;../zensus;../mastr" ../zensus/.venv/Scripts/python \
        -m forest.fetch --country germany --out downloads/germany
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

from mastr.remotezip import HttpRange, RangeSource, central_directory, open_member

RECORD_URL = "https://zenodo.org/api/records/13333034/files/{country}.zip/content"

#: the three layers `raster.py` reads, by file-name stem
WANTED = ("forest_mask", "latest_disturbance", "disturbance_agent_aggregated")


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


class CurlRange(RangeSource):
    """A range source that shells out to curl.

    Zenodo answers small ranges to urllib but stalls indefinitely on the
    multi-megabyte ones this needs, where curl gets the same bytes at over
    2 MB/s. Rather than guess at the header that offends it, borrow the
    tool that works — the same reason `dwd/grids.py` reaches for certifi.
    Falls back to urllib where curl is missing.
    """

    def __init__(self, url: str, timeout: int = 300):
        self.url = url
        self.timeout = timeout
        self.size = HttpRange(url).size

    def read(self, start: int, length: int) -> bytes:
        end = min(self.size, start + length) - 1
        want = end - start + 1
        last = ""
        # Zenodo rate-limits and then drops the connection mid-range, so a
        # read that fails or comes back short is retried rather than fatal.
        for attempt in range(6):
            out = subprocess.run(
                ["curl", "-sSL", "--retry", "3", "--retry-delay", "5",
                 "--retry-all-errors", "-r", f"{start}-{end}", self.url],
                capture_output=True, timeout=self.timeout,
            )
            if out.returncode == 0 and len(out.stdout) == want:
                return out.stdout
            last = (out.stderr.decode(errors="replace")[:160] or
                    f"short read: {len(out.stdout)} of {want} bytes")
            log(f"    retry {attempt + 1}/6 for bytes {start}-{end}: {last}")
            time.sleep(5 * (attempt + 1))
        raise SystemExit(f"curl failed for bytes {start}-{end}: {last}")


def range_source(url: str) -> RangeSource:
    return CurlRange(url) if shutil.which("curl") else HttpRange(url)


def wanted_members(members, country: str):
    names = {f"{stem}_{country}.tif" for stem in WANTED}
    found = [m for m in members if Path(m.name).name in names]
    missing = names - {Path(m.name).name for m in found}
    if missing:
        raise SystemExit(f"archive has no {', '.join(sorted(missing))}")
    return found


def run(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    url = args.url or RECORD_URL.format(country=args.country)
    source = range_source(url)
    log(f"{url}\n  {source.size / 1e9:.1f} GB archive, reading its index")
    members = wanted_members(central_directory(source), args.country)
    total = sum(m.compressed_size for m in members)
    log(f"  {len(members)} member(s), {total / 1e6:.0f} MB to fetch")

    for member in members:
        target = out / Path(member.name).name
        if target.exists() and target.stat().st_size == member.uncompressed_size:
            log(f"  {target.name}: already here")
            continue
        written = 0
        with target.open("wb") as handle:
            for chunk in open_member(source, member, chunk=1 << 20):
                handle.write(chunk)
                written += len(chunk)
        log(f"  {target.name}: {written / 1e6:.0f} MB")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--country", default="germany")
    parser.add_argument("--out", required=True)
    parser.add_argument("--url", default=None, help="override the record URL")
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
