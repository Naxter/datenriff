"""Marktstammdatenregister wind units -> H3 -> binary sculpture buffers.

    Gesamtdatenexport zip (range-read over HTTP, or a local file)
     -> EinheitenWind*.xml streamed with iterparse
     -> units with public coordinates, status and dates
     -> H3 cell per unit
     -> per year 1990…today: MW standing at year end, per cell (cumulative)
     -> aggregate to coarser resolutions (sum)
     -> stats + binary (wind_mw_{year}.f32) + dataset.json

Cumulative capacity per year is what lets the atlas "play" the build-up of
wind power (plan §26). Every year is a metric; the app binds the WIND mode
to the years present and shows the latest, with the timeline.

Source: Bundesnetzagentur, Marktstammdatenregister — Datenlizenz Deutschland
Namensnennung 2.0. Only units with coordinates in the register are used;
positions are never invented from a municipality (plan §24).

The binary writer is shared with the census pipeline
(`pip install -e pipelines/zensus`); everything else is stdlib + h3.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import re
import subprocess
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

from zensus_pipeline.binary_writer import (
    bounds_of,
    compute_stats,
    merge_dataset_manifest,
    write_f32,
    write_positions,
)

from .remotezip import FileRange, HttpRange, MemberStream, central_directory, find_member, open_member
from .units import installed_in_year, parse_units

DOWNLOAD_PAGE = "https://www.marktstammdatenregister.de/MaStR/Datendownload"
H3_EDGE_METERS = {5: 8544.4, 6: 3229.5, 7: 1220.6, 8: 461.4, 9: 174.4}
FIRST_YEAR = 1990


def git_commit() -> str | None:
    try:
        return (
            subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                           capture_output=True, text=True, check=True).stdout.strip()
            or None
        )
    except (OSError, subprocess.CalledProcessError):
        return None


def current_export_url() -> str:
    """The current Gesamtdatenexport link from the download page."""
    with urllib.request.urlopen(DOWNLOAD_PAGE, timeout=60) as res:
        html = res.read().decode("utf-8", "replace")
    m = re.search(r"https://[^\"'\s]*Gesamtdatenexport_\d{8}[^\"'\s]*\.zip", html)
    if not m:
        raise SystemExit(
            f"could not find the Gesamtdatenexport link on {DOWNLOAD_PAGE}; "
            "pass --url or --zip"
        )
    return m.group(0)


def unit_streams(args: argparse.Namespace):
    """(name, byte stream) per EinheitenWind*.xml member of the export."""
    if args.zip:
        src = FileRange(Path(args.zip))
    else:
        url = args.url or current_export_url()
        print(f"  export: {url}", file=sys.stderr)
        src = HttpRange(url)
    members = find_member(central_directory(src), args.member_prefix)
    if not members:
        raise SystemExit(f"no {args.member_prefix}*.xml in the export")
    for m in members:
        print(f"  reading {m.name} ({m.uncompressed_size / 1e6:.0f} MB) …", file=sys.stderr)
        yield m.name, MemberStream(open_member(src, m))


def run(args: argparse.Namespace) -> None:
    import h3

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    resolutions = sorted({int(r) for r in args.resolutions.split(",")}, reverse=True)
    base_res = resolutions[0]
    # The last *complete* year. Running in August and stopping at "this
    # year" put a part-year on the end of the timeline and dated the whole
    # dataset to a 31 December that has not happened yet, so the newest step
    # was always an undercount presented as the present.
    today = _dt.date.today()
    last_year = int(args.last_year) if args.last_year else today.year - 1
    years = list(range(int(args.first_year), last_year + 1))
    west, south, east, north = (float(v) for v in args.bbox.split(","))

    # per year: MW standing at year end, per base cell
    mw_by_year: dict[int, dict[str, float]] = {y: defaultdict(float) for y in years}
    units_total = 0
    units_kept = 0
    for name, stream in unit_streams(args):
        for unit in parse_units(stream, args.element):
            units_total += 1
            if not (west <= unit.lon <= east and south <= unit.lat <= north):
                continue
            if args.onshore_only and unit.offshore:
                continue
            units_kept += 1
            cell = h3.latlng_to_cell(unit.lat, unit.lon, base_res)
            mw = unit.kw / 1000.0
            for y in years:
                if installed_in_year(unit, y):
                    mw_by_year[y][cell] += mw
        print(f"  {name}: {units_total:,} units with coordinates, {units_kept:,} in bbox",
              file=sys.stderr)
    if units_kept == 0:
        raise SystemExit("no units in the bbox")

    metric_entries: list[dict] = []
    lod_fragments: list[dict] = []
    country_res = min(resolutions)
    for res in resolutions:
        values_by_year: dict[int, dict[str, float]] = {}
        for y in years:
            if res == base_res:
                values_by_year[y] = dict(mw_by_year[y])
            else:
                agg: dict[str, float] = defaultdict(float)
                for cell, mw in mw_by_year[y].items():
                    agg[h3.cell_to_parent(cell, res)] += mw
                values_by_year[y] = dict(agg)
        universe = sorted(set().union(*(v.keys() for v in values_by_year.values())))
        res_dir = out / f"r{res}"
        res_dir.mkdir(parents=True, exist_ok=True)
        (res_dir / "cells.txt").write_text("\n".join(universe), encoding="utf-8")
        positions = [(round(lon, 6), round(lat, 6)) for lon, lat in
                     ((h3.cell_to_latlng(c)[1], h3.cell_to_latlng(c)[0]) for c in universe)]
        write_positions(res_dir / "positions.bin", positions)
        stats_by_metric: dict[str, dict] = {}
        for y in years:
            metric_id = f"{args.metric_prefix}_{y}"
            # a cell without turbines that year has 0 MW, not unknown
            aligned = [values_by_year[y].get(c, 0.0) for c in universe]
            write_f32(res_dir / f"{metric_id}.f32", aligned)
            stats = compute_stats(aligned, with_sum=True)
            stats_by_metric[metric_id] = stats
            if res == country_res:
                metric_entries.append({
                    "id": metric_id,
                    "label": f"{args.label} {y}",
                    "unit": "MW",
                    "storage": "f32",
                    "aggregation": "sum",
                    "stats": stats,
                })
        lod_fragments.append({
            "resolution": res,
            "count": len(universe),
            "bounds": bounds_of(positions),
            "cellRadiusMeters": H3_EDGE_METERS.get(res, 461.4),
            "minZoom": 0 if res == country_res else 7.0,
            "positions": f"r{res}/positions.bin",
            "metricTemplate": f"r{res}/{{metric}}",
            "metricStats": stats_by_metric,
        })
        total = stats_by_metric[f"{args.metric_prefix}_{last_year}"].get("sum", 0)
        print(f"  r{res}: {len(universe):,} cells, {total / 1000:.1f} GW in {last_year}",
              file=sys.stderr)

    fragment = {
        "id": args.dataset_id,
        "title": args.dataset_title,
        "spatialResolution": 0,
        "metrics": metric_entries,
        "lods": lod_fragments,
        "source": {
            "label": "Data: Bundesnetzagentur, Marktstammdatenregister",
            "url": DOWNLOAD_PAGE,
            "license": "Datenlizenz Deutschland – Namensnennung – Version 2.0",
            "referenceDate": args.reference_date or f"{last_year}-12-31",
            "provenance": {
                "sourceUrl": args.url or args.zip or DOWNLOAD_PAGE,
                "sourceHash": None,
                "downloadDate": args.download_date or _dt.date.today().isoformat(),
                "pipelineVersion": "mastr-pipeline 0.1.0",
                "gitCommit": git_commit(),
                "generatedAt": _dt.datetime.now(_dt.timezone.utc)
                .isoformat(timespec="seconds").replace("+00:00", "Z"),
            },
        },
    }
    manifest = merge_dataset_manifest(out / "dataset.json", fragment)
    print(f"Wrote {out / 'dataset.json'} ({len(manifest['metrics'])} metrics, "
          f"{len(manifest['lods'])} LODs)", file=sys.stderr)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    src = parser.add_argument_group("source")
    src.add_argument("--zip", help="local Gesamtdatenexport zip")
    src.add_argument("--url", help="export zip URL (default: the current one from the download page)")
    src.add_argument("--member-prefix", default="EinheitenWind",
                     help="XML members to read (EinheitenWind*.xml)")
    src.add_argument("--element", default="EinheitWind", help="unit element name")
    parser.add_argument("--out", required=True)
    parser.add_argument("--bbox", default="5.0,47.0,15.5,56.0",
                        help="west,south,east,north; wide enough for the offshore parks")
    parser.add_argument("--onshore-only", action="store_true")
    parser.add_argument("--resolutions", default="8,7")
    parser.add_argument("--first-year", default=str(FIRST_YEAR))
    parser.add_argument("--last-year", default=None,
                        help="default: last complete year")
    parser.add_argument("--metric-prefix", default="wind_mw")
    parser.add_argument("--label", default="Wind power")
    parser.add_argument("--dataset-id", default="energy")
    parser.add_argument("--dataset-title", default="Energy")
    parser.add_argument("--reference-date", default=None)
    parser.add_argument("--download-date", default=None)
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
