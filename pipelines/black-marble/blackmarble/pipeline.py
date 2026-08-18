"""NASA Black Marble night-light raster -> H3 -> binary sculpture buffers.

    GeoTIFF window over the target bbox
     -> per-pixel brightness
     -> H3 cell of the pixel centre
     -> mean per cell (radiance-like intensities average, never sum)
     -> aggregate to coarser resolutions
     -> stats + binary + dataset.json

Honest naming (plan §19): the openly downloadable Black Marble mosaics are
8-bit **visualisations**, not calibrated radiance. This pipeline therefore
writes a metric called `light_brightness` with no physical unit. Calibrated
VNP46A3 radiance needs an Earthdata login token; point `--input` at such a
GeoTIFF and pass `--metric night_radiance --unit "nW/cm2/sr"` instead.

The binary writer is shared with the census pipeline; install it first
(`pip install -e pipelines/zensus`).

Example:

    python -m blackmarble.pipeline \\
        --input downloads/BlackMarble_2016_3km_geo.tif \\
        --resolutions 7 --label "Night lights 2016" \\
        --out ../../apps/web/public/data/afterdark
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import subprocess
import sys
from pathlib import Path

from zensus_pipeline.binary_writer import (
    bounds_of,
    compute_stats,
    merge_dataset_manifest,
    write_f32,
    write_positions,
)

from .aggregate import accumulate_mean, aggregate_mean_to_parent

# H3 edge lengths in metres, for the renderer's column radius
H3_EDGE_METERS = {5: 8544.4, 6: 3229.5, 7: 1220.6, 8: 461.4}
# ITU-R BT.709 luma: the composite is near-greyscale, but weighting keeps
# the faint blue-white city cores from being over- or under-read
LUMA = (0.2126, 0.7152, 0.0722)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_commit() -> str | None:
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


def load_clip_rings(path: Path) -> list[list[tuple[float, float]]]:
    """Rings from the atlas boundary file ({"rings": [[[lon, lat], ...]]})."""
    import json

    data = json.loads(path.read_text(encoding="utf-8"))
    return [[(float(x), float(y)) for x, y in ring] for ring in data["rings"]]


def point_in_rings(lon: float, lat: float, rings) -> bool:
    """Even-odd test; the atlas boundary is a simple outline per ring."""
    for ring in rings:
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        if inside:
            return True
    return False


def sample_pixels(
    path: Path,
    bbox: tuple[float, float, float, float],
    floor: float,
    rings=None,
):
    """Yield (lon, lat, brightness) for pixel centres inside the bbox and,
    when given, inside the clip rings — the bbox alone drags in France,
    Poland and the North Sea."""
    import rasterio
    from rasterio.windows import from_bounds

    west, south, east, north = bbox
    with rasterio.open(path) as ds:
        window = from_bounds(west, south, east, north, ds.transform)
        data = ds.read(window=window)
        transform = ds.window_transform(window)
        bands = data.shape[0]
        rows, cols = data.shape[1], data.shape[2]
        print(f"  window {cols} x {rows} px, {bands} band(s)", file=sys.stderr)
        for r in range(rows):
            for c in range(cols):
                if bands >= 3:
                    value = (
                        LUMA[0] * float(data[0, r, c])
                        + LUMA[1] * float(data[1, r, c])
                        + LUMA[2] * float(data[2, r, c])
                    )
                else:
                    value = float(data[0, r, c])
                if value <= floor:
                    continue
                # pixel centre
                lon = transform.c + transform.a * (c + 0.5)
                lat = transform.f + transform.e * (r + 0.5)
                if rings is not None and not point_in_rings(lon, lat, rings):
                    continue
                yield lon, lat, value


def run(args: argparse.Namespace) -> None:
    import h3

    input_path = Path(args.input)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    resolutions = sorted({int(r) for r in args.resolutions.split(",")}, reverse=True)
    base_res = resolutions[0]
    bbox = tuple(float(v) for v in args.bbox.split(","))  # type: ignore[assignment]

    rings = load_clip_rings(Path(args.clip)) if args.clip else None
    if rings:
        print(f"  clipping to {len(rings)} ring(s) from {Path(args.clip).name}",
              file=sys.stderr)

    print(f"Streaming {input_path.name} → H3 r{base_res} …", file=sys.stderr)
    samples = (
        (h3.latlng_to_cell(lat, lon, base_res), value)
        for lon, lat, value in sample_pixels(input_path, bbox, args.floor, rings)  # type: ignore[arg-type]
    )
    means, counts = accumulate_mean(samples)
    print(f"  {len(means):,} lit r{base_res} cells", file=sys.stderr)
    if not means:
        raise SystemExit("No lit pixels in the bbox — check --bbox and --floor")

    metric_entries: list[dict] = []
    lod_fragments: list[dict] = []
    country_res = min(resolutions)

    for res in resolutions:
        if res == base_res:
            values: dict[str, float | None] = dict(means)
            weights = counts
        else:
            values, weights = aggregate_mean_to_parent(
                means, counts, lambda c, r=res: h3.cell_to_parent(c, r)
            )
        res_dir = out / f"r{res}"
        res_dir.mkdir(parents=True, exist_ok=True)
        universe = sorted(values)
        (res_dir / "cells.txt").write_text("\n".join(universe), encoding="utf-8")
        positions = [(round(lon, 6), round(lat, 6)) for lon, lat in
                     ((h3.cell_to_latlng(cell)[1], h3.cell_to_latlng(cell)[0])
                      for cell in universe)]
        write_positions(res_dir / "positions.bin", positions)
        aligned = [values.get(cell) for cell in universe]
        write_f32(res_dir / f"{args.metric}.f32", aligned)
        stats = compute_stats(aligned)
        if res == country_res:
            metric_entries.append(
                {
                    "id": args.metric,
                    "label": args.label,
                    "unit": args.unit,
                    "storage": "f32",
                    "aggregation": "weightedMean",
                    "stats": stats,
                }
            )
        lod_fragments.append(
            {
                "resolution": res,
                "count": len(universe),
                "bounds": bounds_of(positions),
                "cellRadiusMeters": H3_EDGE_METERS.get(res, 1220.6),
                "minZoom": 0 if res == country_res else 7.0,
                "positions": f"r{res}/positions.bin",
                "metricTemplate": f"r{res}/{{metric}}",
            }
        )
        print(f"  r{res}: {len(universe):,} cells", file=sys.stderr)

    fragment = {
        "id": args.dataset_id,
        "title": args.dataset_title,
        "spatialResolution": args.spatial_resolution,
        "metrics": metric_entries,
        "lods": lod_fragments,
        "source": {
            "label": args.attribution,
            "url": "https://www.earthdata.nasa.gov/data/projects/black-marble",
            "license": "NASA Earth Observatory, free to use with attribution",
            "referenceDate": args.reference_date,
            "provenance": {
                "sourceUrl": args.source_url,
                "sourceHash": f"sha256:{sha256_of(input_path)}",
                "downloadDate": args.download_date,
                "pipelineVersion": "blackmarble-pipeline 0.1.0",
                "gitCommit": git_commit(),
                "generatedAt": _dt.datetime.now(_dt.timezone.utc)
                .isoformat(timespec="seconds")
                .replace("+00:00", "Z"),
            },
        },
    }
    manifest = merge_dataset_manifest(out / "dataset.json", fragment)
    print(
        f"Wrote {out / 'dataset.json'} "
        f"({len(manifest['metrics'])} metrics, {len(manifest['lods'])} LODs)",
        file=sys.stderr,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Black Marble GeoTIFF")
    parser.add_argument("--out", required=True, help="Output dataset directory")
    parser.add_argument(
        "--bbox",
        default="5.8,47.2,15.1,55.1",
        help="west,south,east,north in WGS84 (default: Germany)",
    )
    parser.add_argument(
        "--resolutions", default="7", help="comma-separated H3 resolutions, finest first"
    )
    parser.add_argument("--metric", default="light_brightness")
    parser.add_argument("--label", default="Night-light brightness")
    parser.add_argument("--unit", default=None)
    parser.add_argument(
        "--floor",
        type=float,
        default=2.0,
        help="drop pixels at or below this brightness (sensor floor / unlit)",
    )
    parser.add_argument(
        "--clip",
        help="boundary JSON ({\"rings\": …}) to clip pixels to, e.g. the "
        "atlas outline in apps/web/public/data/boundary.json",
    )
    parser.add_argument("--dataset-id", default="afterdark")
    parser.add_argument("--dataset-title", default="After Dark")
    parser.add_argument("--spatial-resolution", type=int, default=3000)
    parser.add_argument("--reference-date", default="2016-01-01")
    parser.add_argument("--attribution", default="Data: NASA Black Marble")
    parser.add_argument("--source-url")
    parser.add_argument("--download-date")
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
