"""Range-zip reader, unit parser and an end-to-end run on a synthetic export."""


from __future__ import annotations

import unittest

def _skip_without(*modules):
    """Skip rather than error when the scientific stack is absent."""
    import importlib
    for name in modules:
        try:
            importlib.import_module(name)
        except ImportError:
            raise unittest.SkipTest(f'{name} is not installed')

_skip_without('h3')

import datetime as dt
import io
import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

from mastr import remotezip, units

WIND_XML = """<?xml version="1.0" encoding="UTF-16"?>
<EinheitenWind>
  <EinheitWind>
    <EinheitMastrNummer>SEE900000000001</EinheitMastrNummer>
    <Bundesland>1403</Bundesland>
    <Laengengrad>8.68</Laengengrad>
    <Breitengrad>53.10</Breitengrad>
    <Inbetriebnahmedatum>2005-06-01</Inbetriebnahmedatum>
    <EinheitBetriebsstatus>35</EinheitBetriebsstatus>
    <Bruttoleistung>2000</Bruttoleistung>
    <Lage>888</Lage>
  </EinheitWind>
  <EinheitWind>
    <EinheitMastrNummer>SEE900000000002</EinheitMastrNummer>
    <Laengengrad>8.681</Laengengrad>
    <Breitengrad>53.101</Breitengrad>
    <Inbetriebnahmedatum>1998-03-15</Inbetriebnahmedatum>
    <DatumEndgueltigeStilllegung>2015-01-10</DatumEndgueltigeStilllegung>
    <EinheitBetriebsstatus>38</EinheitBetriebsstatus>
    <Bruttoleistung>600</Bruttoleistung>
    <Lage>888</Lage>
  </EinheitWind>
  <EinheitWind>
    <EinheitMastrNummer>SEE900000000003</EinheitMastrNummer>
    <Laengengrad>6.5</Laengengrad>
    <Breitengrad>54.4</Breitengrad>
    <Inbetriebnahmedatum>2020-09-01</Inbetriebnahmedatum>
    <EinheitBetriebsstatus>35</EinheitBetriebsstatus>
    <Bruttoleistung>8000</Bruttoleistung>
    <Lage>889</Lage>
  </EinheitWind>
  <EinheitWind>
    <EinheitMastrNummer>SEE900000000004</EinheitMastrNummer>
    <Inbetriebnahmedatum>2021-01-01</Inbetriebnahmedatum>
    <EinheitBetriebsstatus>35</EinheitBetriebsstatus>
    <Bruttoleistung>3000</Bruttoleistung>
  </EinheitWind>
  <EinheitWind>
    <EinheitMastrNummer>SEE900000000005</EinheitMastrNummer>
    <Laengengrad>10.0</Laengengrad>
    <Breitengrad>51.0</Breitengrad>
    <Inbetriebnahmedatum>2027-01-01</Inbetriebnahmedatum>
    <EinheitBetriebsstatus>31</EinheitBetriebsstatus>
    <Bruttoleistung>5000</Bruttoleistung>
    <Lage>888</Lage>
  </EinheitWind>
</EinheitenWind>
"""


def make_export(path: Path) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("AnlagenEegWind.xml", "<x/>")
        info = zipfile.ZipInfo("EinheitenWind.xml")
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, WIND_XML.encode("utf-16"))
        z.writestr("EinheitenSolar_1.xml", "<x/>" * 100)


class TestRemoteZip(unittest.TestCase):
    def test_central_directory_and_member_stream(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "export.zip"
            make_export(path)
            src = remotezip.FileRange(path)
            members = remotezip.central_directory(src)
            names = sorted(m.name for m in members)
            self.assertEqual(names, ["AnlagenEegWind.xml", "EinheitenSolar_1.xml", "EinheitenWind.xml"])
            wind = remotezip.find_member(members, "EinheitenWind")
            self.assertEqual([m.name for m in wind], ["EinheitenWind.xml"])
            data = b"".join(remotezip.open_member(src, wind[0], chunk=64))
            self.assertEqual(data, WIND_XML.encode("utf-16"))
            stream = remotezip.MemberStream(remotezip.open_member(src, wind[0], chunk=64))
            self.assertEqual(stream.read(), WIND_XML.encode("utf-16"))

    def test_stored_member(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "stored.zip"
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as z:
                z.writestr("EinheitenWind.xml", "hello")
            src = remotezip.FileRange(path)
            m = remotezip.central_directory(src)[0]
            self.assertEqual(m.method, 0)
            self.assertEqual(b"".join(remotezip.open_member(src, m)), b"hello")

    def test_zip64_extra_fields_are_read(self):
        # zipfile only writes zip64 records past 4 GiB, so hand-craft a
        # central directory entry with a zip64 extra block
        name = b"EinheitenWind.xml"
        extra = struct.pack("<HH", 0x0001, 24) + struct.pack("<QQQ", 5, 7, 11)
        entry = (
            remotezip.CENTRAL_SIG
            + struct.pack("<HHHHHHIIIHHHHHII", 45, 45, 0, 8, 0, 0, 0, 0xFFFFFFFF, 0xFFFFFFFF,
                          len(name), len(extra), 0, 0, 0, 0, 0xFFFFFFFF)
            + name + extra
        )
        eocd64 = (
            remotezip.EOCD64_SIG + struct.pack("<QHHIIQQQQ", 44, 45, 45, 0, 0, 1, 1, len(entry), 0)
        )
        locator = remotezip.EOCD64_LOCATOR_SIG + struct.pack("<IQI", 0, len(entry), 1)
        eocd = remotezip.EOCD_SIG + struct.pack("<HHHHIIH", 0, 0, 0xFFFF, 0xFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0)
        blob = entry + eocd64 + locator + eocd

        class Bytes(remotezip.RangeSource):
            size = len(blob)

            def read(self, start, length):
                return blob[start:start + length]

        members = remotezip.central_directory(Bytes())
        self.assertEqual(len(members), 1)
        m = members[0]
        self.assertEqual((m.uncompressed_size, m.compressed_size, m.local_header_offset), (5, 7, 11))


class TestUnits(unittest.TestCase):
    def parsed(self):
        return list(units.parse_units(io.BytesIO(WIND_XML.encode("utf-16"))))

    def test_units_without_coordinates_are_dropped(self):
        ids = [u.id for u in self.parsed()]
        self.assertNotIn("SEE900000000004", ids)
        self.assertEqual(len(ids), 4)

    def test_fields(self):
        u = next(u for u in self.parsed() if u.id == "SEE900000000002")
        self.assertEqual(u.kw, 600)
        self.assertEqual(u.commissioned, dt.date(1998, 3, 15))
        self.assertEqual(u.decommissioned, dt.date(2015, 1, 10))
        self.assertEqual(u.status, 38)
        self.assertFalse(u.offshore)
        off = next(u for u in self.parsed() if u.id == "SEE900000000003")
        self.assertTrue(off.offshore)

    def test_installed_in_year(self):
        by_id = {u.id: u for u in self.parsed()}
        u2 = by_id["SEE900000000002"]   # 1998 → shut 2015-01
        self.assertFalse(units.installed_in_year(u2, 1997))
        self.assertTrue(units.installed_in_year(u2, 1998))
        self.assertTrue(units.installed_in_year(u2, 2014))
        self.assertFalse(units.installed_in_year(u2, 2015))
        planned = by_id["SEE900000000005"]
        self.assertFalse(units.installed_in_year(planned, 2027))


class TestPipeline(unittest.TestCase):
    def test_end_to_end(self):
        from mastr import pipeline

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "export.zip"
            make_export(path)
            out = Path(tmp) / "out"
            pipeline.main([
                "--zip", str(path), "--out", str(out), "--resolutions", "8,7",
                "--first-year", "1997", "--last-year", "2021",
            ])
            manifest = json.loads((out / "dataset.json").read_text(encoding="utf-8"))
            ids = [m["id"] for m in manifest["metrics"]]
            self.assertEqual(ids[0], "wind_mw_1997")
            self.assertEqual(ids[-1], "wind_mw_2021")
            self.assertEqual(manifest["metrics"][0]["unit"], "MW")
            cells = (out / "r8" / "cells.txt").read_text().split()
            n = len(cells)
            # units 1 and 2 share an r8 cell (110 m apart), unit 3 is offshore
            self.assertEqual(n, 2)
            v1997 = struct.unpack(f"<{n}f", (out / "r8" / "wind_mw_1997.f32").read_bytes())
            v2010 = struct.unpack(f"<{n}f", (out / "r8" / "wind_mw_2010.f32").read_bytes())
            v2021 = struct.unpack(f"<{n}f", (out / "r8" / "wind_mw_2021.f32").read_bytes())
            self.assertAlmostEqual(sum(v1997), 0.0)                    # nothing yet
            self.assertAlmostEqual(sum(v2010), 2.6, places=5)          # 2.0 + 0.6
            self.assertAlmostEqual(sum(v2021), 2.0 + 8.0, places=5)    # 0.6 shut, 8 offshore
            r7 = next(l for l in manifest["lods"] if l["resolution"] == 7)
            self.assertAlmostEqual(r7["metricStats"]["wind_mw_2021"]["sum"], 10.0, places=5)
            self.assertEqual(manifest["source"]["license"],
                             "Datenlizenz Deutschland – Namensnennung – Version 2.0")


if __name__ == "__main__":
    unittest.main()
