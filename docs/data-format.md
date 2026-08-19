# Data format

No GeoJSON, no object arrays: every LOD consists of raw little-endian typed
array buffers plus a JSON manifest.

## File layout of a dataset

```
data/zensus/
├── dataset.json          # manifest fragment, merged by scripts/build-manifest.mjs
├── r7/                   # country LOD for the mobile quality profile
├── r8/                   # country LOD for desktop
│   ├── cells.txt         # canonical H3 cell order
│   ├── positions.bin     # float32, interleaved [lon, lat, lon, lat, …]
│   ├── population_2022.f32   # float32 per cell; NaN = missing/suppressed
│   ├── heating_category.u8   # uint8 per cell; 255 = missing
│   └── heating_dominance.u8  # uint8; 0–255 ≙ 0–1
└── r9/                   # regional LOD, streamed
    ├── index.json        # tile bounds + per-LOD metric stats (+ "packed")
    └── tiles/
        └── 851f1c6ffffffff.pack   # positions + every metric of the tile
```

All buffers of one LOD share the same cell order — geometry is loaded once and
metric buffers are swapped. The cell universe is defined by the first pipeline
run (population); later metrics are aligned to it and missing cells are NaN.

Fine LODs are split into tiles grouped by a coarser H3 parent (r5), so the
viewer fetches only what the viewport needs. A tiled LOD also keeps its
whole-LOD buffers — the tiles are sliced from them — but those are **not** a
country-LOD candidate: loading 830k cells up front is what tiling exists to
prevent.

Each metric run writes its tile buffers loose (`<tile>.<metric>.f32`);
`python -m zensus_pipeline.pack --lod r9` then folds a tile's positions and
every metric into one `<tile>.pack` — `"DRTL"`, u32 version, u32 header
length, a JSON header with the section table (`name`, `dtype`, `size`,
`offset`, `length`), then the 4-byte-aligned payload — and points the
manifest's LOD entry at it (`tilePackTemplate`). One request per tile
instead of one per metric, and 1,724 files instead of 19,000. Loose tiles
still work when no pack template is set.

## Manifest

`/data/manifest.json` follows `AtlasManifest` from `@datenriff/data-contracts`:

```jsonc
{
  "version": 1,
  "datasets": [{
    "id": "zensus",
    "spatialResolution": 100,
    "metrics": [{
      "id": "population_2022",
      "storage": "f32",              // f32 | u8
      "aggregation": "sum",          // sum | weightedMean | share | categoricalDominant
      "stats": { "min": 0, "max": 17690, "p50": 48, "p95": 1163, "p995": 4807, "sum": 82570995 }
    }],
    "time": { "kind": "steps", "steps": ["2011", "2022"], "metricTemplate": "population_{step}" },
    "lods": [{
      "resolution": 8,
      "count": 272503,
      "bounds": [5.87, 47.27, 15.03, 55.05],
      "cellRadiusMeters": 461.4,
      "minZoom": 0,
      "positions": "/data/zensus/r8/positions.bin",
      "metricTemplate": "/data/zensus/r8/{metric}",  // {metric} → "<id>.<storage>"
      // stats for *this* resolution — see below
      "metricStats": { "population_2022": { "p995": 4807, "…": 0 } }
    }],
    "source": {
      "label": "Data: Destatis, Zensus 2022",
      "license": "Datenlizenz Deutschland – Namensnennung – 2.0",
      "provenance": { "sourceHash": "sha256:…", "gitCommit": "…", "generatedAt": "…" }
    }
  }],
  "labels": "/data/cities.json",
  "boundary": "/data/boundary.json"
}
```

Statistics are computed offline and drive colour clipping and height
calibration without a runtime scan.

**Stats belong to a LOD, not to a dataset.** Coarser cells pool more people,
so the same metric has a different distribution at every resolution:

| metric | r7 | r8 | r9 |
| --- | --- | --- | --- |
| population 2022, p99.5 | 21,225 | 4,807 | 1,195 |
| population 2022, sum | 82,570,995 | 82,570,995 | 82,570,995 |

Calibrating one resolution with another's stats flattens the sculpture (or
blows it out). `SculptureLOD.metricStats` carries them per resolution; the
tiled LODs carry theirs in `index.json`. The identical sum across resolutions
is the check that the aggregation is sound.

## Aggregation rules

| Type | Examples | Rule |
| --- | --- | --- |
| Counts | inhabitants, dwellings | SUM |
| Averages | age, rent, vacancy rate | SUM(value·weight) / SUM(weight) |
| Shares | built 2014+ | SUM(numerator) / SUM(denominator) — never mean(%) |
| Categories | heating energy carrier | category sums → argmax, plus dominance = max/total |
| Change | 2011→2022 | Δ/base, suppressed below the minimum denominator |
| Intensities | night-light brightness | mean weighted by pixel count — never a sum |

A published *rate* (vacancy) cannot use the share rule, because numerator and
denominator are not in the data; it aggregates as a weighted mean instead.

## Missing values

Two kinds of marker, and they mean opposite things:

- **Nil** (`–`, `-`) is a real zero — the census legend reads "– = Genau Null
  oder auf Null geändert". It parses to `0.0` and keeps its cell in the data.
  Reading it as missing deletes the cell from a share, denominator included,
  which pools the ratio over only the cells that had something to report.
- **Withheld or unknown** (`.`, `/`, `x`, …) is missing, never zero.
- Release-specific markers exist: the 2011 grid writes `-1` for uninhabited
  or suppressed cells (`--treat-missing "-1"`), and such a marker outranks
  both tables above.
- f32 buffers: NaN; u8 buffers: 255.
- Renderer: NaN → height 0 plus the "suppressed" colour.

## Size

The census country LODs: r8 ≈ 272k cells (positions 2.2 MB, one f32 metric
1.1 MB), r7 ≈ 69k cells (3.2 MB for all ten metrics). The r9 tile set is
~100 MB across 1,723 tiles and is fetched by viewport, never as a whole.
