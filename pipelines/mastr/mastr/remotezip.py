"""Read single members out of a (very large) zip without fetching all of it.

The MaStR full export is one zip of several gigabytes; the wind units are
one ~100 MB XML inside. HTTP range requests fetch the central directory
from the tail, then just the member's bytes. Zip64 is handled (the export
is far past 4 GB). A local file goes through the same code path via
`FileRange`, which is also how the parser is tested.

Only stored (0) and deflated (8) members are supported — all the export
uses.
"""

from __future__ import annotations

import io
import struct
import urllib.request
import zlib
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

EOCD_SIG = b"PK\x05\x06"
EOCD64_LOCATOR_SIG = b"PK\x06\x07"
EOCD64_SIG = b"PK\x06\x06"
CENTRAL_SIG = b"PK\x01\x02"
LOCAL_SIG = b"PK\x03\x04"


class RangeSource:
    """Bytes of a resource by absolute range."""

    size: int

    def read(self, start: int, length: int) -> bytes:  # pragma: no cover - interface
        raise NotImplementedError


class FileRange(RangeSource):
    def __init__(self, path: Path):
        self.path = Path(path)
        self.size = self.path.stat().st_size

    def read(self, start: int, length: int) -> bytes:
        with self.path.open("rb") as fh:
            fh.seek(start)
            return fh.read(length)


class HttpRange(RangeSource):
    def __init__(self, url: str, timeout: int = 120):
        self.url = url
        self.timeout = timeout
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=timeout) as res:
            length = res.headers.get("Content-Length")
            accept = (res.headers.get("Accept-Ranges") or "").lower()
        if not length:
            raise SystemExit(f"{url}: no Content-Length; cannot range-read")
        if accept and accept != "bytes":
            raise SystemExit(f"{url}: server does not accept byte ranges")
        self.size = int(length)

    def read(self, start: int, length: int) -> bytes:
        end = min(self.size, start + length) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}"})
        with urllib.request.urlopen(req, timeout=self.timeout) as res:
            if res.status != 206:
                raise SystemExit(f"{self.url}: expected 206 Partial Content, got {res.status}")
            return res.read()


@dataclass
class Member:
    name: str
    method: int
    compressed_size: int
    uncompressed_size: int
    local_header_offset: int


def _u16(b: bytes, o: int) -> int:
    return struct.unpack_from("<H", b, o)[0]


def _u32(b: bytes, o: int) -> int:
    return struct.unpack_from("<I", b, o)[0]


def _u64(b: bytes, o: int) -> int:
    return struct.unpack_from("<Q", b, o)[0]


def central_directory(src: RangeSource) -> list[Member]:
    """Parse the central directory (zip or zip64) from the tail."""
    tail_len = min(src.size, 65_536 + 22)
    tail = src.read(src.size - tail_len, tail_len)
    eocd = tail.rfind(EOCD_SIG)
    if eocd < 0:
        raise ValueError("no end-of-central-directory record: not a zip?")
    cd_size = _u32(tail, eocd + 12)
    cd_offset = _u32(tail, eocd + 16)
    entries = _u16(tail, eocd + 10)
    if cd_offset == 0xFFFFFFFF or cd_size == 0xFFFFFFFF or entries == 0xFFFF:
        loc = tail.rfind(EOCD64_LOCATOR_SIG, 0, eocd)
        if loc < 0:
            raise ValueError("zip64 markers without a zip64 locator")
        eocd64_offset = _u64(tail, loc + 8)
        rec = src.read(eocd64_offset, 56)
        if rec[:4] != EOCD64_SIG:
            raise ValueError("bad zip64 end-of-central-directory record")
        entries = _u64(rec, 32)
        cd_size = _u64(rec, 40)
        cd_offset = _u64(rec, 48)
    cd = src.read(cd_offset, cd_size)
    members: list[Member] = []
    pos = 0
    for _ in range(entries):
        if cd[pos:pos + 4] != CENTRAL_SIG:
            raise ValueError("bad central directory entry")
        method = _u16(cd, pos + 10)
        csize = _u32(cd, pos + 20)
        usize = _u32(cd, pos + 24)
        name_len = _u16(cd, pos + 28)
        extra_len = _u16(cd, pos + 30)
        comment_len = _u16(cd, pos + 32)
        offset = _u32(cd, pos + 42)
        name = cd[pos + 46:pos + 46 + name_len].decode("utf-8", "replace")
        extra = cd[pos + 46 + name_len:pos + 46 + name_len + extra_len]
        # zip64 extended information: fields present only where the 32-bit
        # value is 0xFFFFFFFF, in this order
        e = 0
        while e + 4 <= len(extra):
            tag = _u16(extra, e)
            size = _u16(extra, e + 2)
            body = extra[e + 4:e + 4 + size]
            if tag == 0x0001:
                b = 0
                if usize == 0xFFFFFFFF and b + 8 <= len(body):
                    usize = _u64(body, b)
                    b += 8
                if csize == 0xFFFFFFFF and b + 8 <= len(body):
                    csize = _u64(body, b)
                    b += 8
                if offset == 0xFFFFFFFF and b + 8 <= len(body):
                    offset = _u64(body, b)
                    b += 8
            e += 4 + size
        members.append(Member(name, method, csize, usize, offset))
        pos += 46 + name_len + extra_len + comment_len
    return members


def open_member(src: RangeSource, member: Member, chunk: int = 4 << 20) -> Iterator[bytes]:
    """Yield the decompressed bytes of a member, chunk by chunk."""
    head = src.read(member.local_header_offset, 30)
    if head[:4] != LOCAL_SIG:
        raise ValueError(f"{member.name}: bad local header")
    name_len = _u16(head, 26)
    extra_len = _u16(head, 28)
    start = member.local_header_offset + 30 + name_len + extra_len
    remaining = member.compressed_size
    if member.method == 0:
        pos = start
        while remaining > 0:
            n = min(chunk, remaining)
            yield src.read(pos, n)
            pos += n
            remaining -= n
        return
    if member.method != 8:
        raise ValueError(f"{member.name}: unsupported compression method {member.method}")
    inflater = zlib.decompressobj(-15)
    pos = start
    while remaining > 0:
        n = min(chunk, remaining)
        data = src.read(pos, n)
        pos += n
        remaining -= n
        out = inflater.decompress(data)
        if out:
            yield out
    tail = inflater.flush()
    if tail:
        yield tail


class MemberStream(io.RawIOBase):
    """File-like view over `open_member`, for parsers that want `.read()`."""

    def __init__(self, chunks: Iterator[bytes]):
        self._chunks = chunks
        self._buf = b""
        self._eof = False

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        while len(self._buf) < len(b) and not self._eof:
            try:
                self._buf += next(self._chunks)
            except StopIteration:
                self._eof = True
        n = min(len(b), len(self._buf))
        b[:n] = self._buf[:n]
        self._buf = self._buf[n:]
        return n


def find_member(members: list[Member], prefix: str, suffix: str = ".xml") -> list[Member]:
    """Members like `EinheitenWind*.xml`, sorted by name."""
    return sorted(
        (m for m in members if m.name.startswith(prefix) and m.name.endswith(suffix)),
        key=lambda m: m.name,
    )
