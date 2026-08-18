# Data format

No GeoJSON, no object arrays: every LOD consists of raw little-endian typed
array buffers plus a JSON manifest.

## File layout of one LOD

```
data/<dataset>/r8/
├── cells.txt            # (pipeline) canonical H3 cell order
├── positions.bin        # float32, interleaved [lon, lat, lon, lat, …]
├── population_2022.f32  # float32 per cell; NaN = missing/suppressed
├── population_2011.f32
├── heating_category.u8  # uint8 per cell; 255 = missing
└── heating_dominance.u8 # uint8; 0–255 ≙ 0–1
```

All buffers of one LOD share the same cell order — geometry is loaded once and
metric buffers are swapped. The cell universe is defined by the first pipeline
run (population); later metrics are aligned to it and missing cells are NaN.

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
      "stats": { "min": 0, "max": 73648, "p50": 752, "p95": 3119, "p995": 13206, "sum": 82699946 }
    }],
    "time": { "kind": "steps", "steps": ["2011", "2022"], "metricTemplate": "population_{step}" },
    "lods": [{
      "resolution": 8,
      "count": 69508,
      "bounds": [5.87, 47.27, 15.03, 55.05],
      "cellRadiusMeters": 461.4,
      "minZoom": 0,
      "positions": "/data/zensus/r8/positions.bin",
      "metricTemplate": "/data/zensus/r8/{metric}"   // {metric} → "<id>.<storage>"
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

The statistics (p50/p95/p995) are computed offline and drive colour clipping
and height calibration without a runtime scan.

## Aggregation rules

| Type | Examples | Rule |
| --- | --- | --- |
| Counts | inhabitants, dwellings | SUM |
| Averages | age, rent | SUM(value·weight) / SUM(weight) |
| Shares | vacancy, share ≥65 | SUM(numerator) / SUM(denominator) — never mean(%) |
| Categories | heating energy carrier | category sums → argmax, plus dominance = max/total |
| Change | 2011→2022 | Δ/base, suppressed below the minimum denominator |

## Missing values

- Official suppression markers (`–`, `.`, `x`, …) are missing, never zero.
- f32 buffers: NaN; u8 buffers: 255.
- Renderer: NaN → height 0 plus the "suppressed" colour.

## Size

A country LOD with ~500k cells: positions ≈ 4 MB, one f32 metric ≈ 2 MB —
considerably less with Brotli. The complete census country set can be served
statically; r9/r10 are tiled by H3 parent.
