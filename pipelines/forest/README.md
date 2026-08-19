# Forest pipeline (FOREST)

Turns the European Forest Disturbance Atlas into the atlas binary format:
H3 cells, forest cover, the share of that forest disturbed since 1985, and
the cause that took the most of it.

## Data

The [European Forest Disturbance Atlas](https://zenodo.org/records/13333034)
maps annual forest disturbances across 38 European countries from Landsat,
1985–2023, at 30 m. Open data under CC BY 4.0 — the source must be named,
and the app does that while the mode is on screen.

```bash
cd pipelines/forest
curl -sL -o downloads/germany.zip \
  https://zenodo.org/api/records/13333034/files/germany.zip/content
python -c "import zipfile; zipfile.ZipFile('downloads/germany.zip').extractall('downloads/germany')"
```

3.1 GB compressed. Nine layers ship per country; three are read:

| File | What it holds |
| --- | --- |
| `forest_mask_germany.tif` | 1 where forest |
| `latest_disturbance_germany.tif` | year of the most recent disturbance |
| `disturbance_agent_aggregated_germany.tif` | 1 wind/bark beetle · 2 fire · 3 harvest · 4 mixed |

All three are EPSG:3035, 30 m, on one grid — the pipeline refuses them if
they are not.

## Run

```bash
PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m forest.pipeline \
  --input downloads/germany --country germany \
  --out ../../apps/web/public/data/forest
cd ../zensus && .venv/Scripts/python -m zensus_pipeline.pack \
  --lod ../../apps/web/public/data/forest/r8
cd ../.. && npm run build:manifest
```

Then pack the tiles — an unpacked tiled LOD is one file per tile per metric,
which the deploy notices.

## How the numbers are made

- **Blocks before hexagons.** Germany is ~600 million pixels at 30 m, far
  too many to hand to H3 one at a time. The rasters are reduced in 2 × 2
  pixel blocks (60 m, comfortably finer than an r10 cell at ~116 m across),
  and only blocks that hold forest go on. That is ~35 million points, about
  half a minute of H3 lookups instead of ten.
- **Counts are carried, not shares.** Each cell holds forest pixels,
  disturbed pixels and a count per cause. A parent adds up its children and
  divides once, so the country view and the tile view agree. Averaging
  shares instead would let a cell with ten pixels outvote one with a
  thousand.
- **`forest_share` is area, not pixels.** Forest pixels × 900 m² over the
  cell's own area from `h3.cell_area`, capped at 1. H3 cells shrink towards
  the poles, so a fixed pixels-per-cell constant would tilt the map from
  south to north.
- **`disturbed_share` is a share of the forest**, not of the cell: of the
  trees that are here, how many were hit at least once since 1985.
- **A cause is only named where there is one.** Forest that was never
  disturbed has no dominant agent — that is missing, not "harvest".
- **Disturbance is read from the forest mask outward**: a disturbed pixel
  outside the mask is not forest loss and is not counted.

## Tests

```bash
PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m unittest discover -s tests -t .
```

Synthetic GeoTIFFs written into a temporary directory, so the suite runs
without the 3.1 GB download. They pin the block arithmetic (including the
strip boundary, where a block must not be split and counted twice), the
share definitions, and the pooling rule.
