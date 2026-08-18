# Black Marble pipeline

Turns NASA Black Marble night lights into the atlas binary format: H3
cells, mean radiance per cell and year, stats, `dataset.json`. Every year
becomes a metric `light_<year>`; the app shows the latest year and offers a
timeline when there are several.

## Data: VNP46A4 (the real thing)

`VNP46A4` is the calibrated annual composite: 500 m pixels, median
nighttime radiance in nW/cm²/sr, with a per-pixel quality flag, from 2012
on. Germany needs the four tiles h18v03, h18v04, h19v03, h19v04 per year
(~4 × 100 MB).

Access needs a free NASA Earthdata account:

1. Register at https://urs.earthdata.nasa.gov, then Profile → *Generate
   Token* and copy it.
2. `export EARTHDATA_TOKEN=...` (PowerShell: `$env:EARTHDATA_TOKEN="..."`).
   Never write it into the repo.
3. Run the pipeline; missing tiles are downloaded into `--tiles-dir`.
   Files fetched by hand work too, e.g.
   `wget --header "Authorization: Bearer $EARTHDATA_TOKEN" <url>` from
   https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5000/VNP46A4/<year>/001/.

```bash
cd pipelines/black-marble
../zensus/.venv/Scripts/pip install h5py
PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m blackmarble.pipeline \
  --vnp46 --years 2012-2024 --tiles-dir downloads/vnp46a4 \
  --resolutions 8,7 --floor 0.5 --unit "nW/cm²/sr" \
  --clip ../../apps/web/public/data/boundary.json \
  --label "Night light" \
  --out ../../apps/web/public/data/afterdark
```

- `--floor 0.5`: radiance at or below this is sensor floor / airglow, not
  settlement. Cells lit in one year but not another are written as 0 for
  the dark year (below the floor), not as missing.
- Quality: persistent lights (0) and gap-filled (2) are kept, ephemeral
  lights (1: fires, boats, flares) dropped. `--keep-quality 0,1,2` keeps
  everything.
- Aggregation is a **mean** weighted by pixel count (plan §92): radiance is
  an intensity, two neighbouring pixels of 30 do not make 60.
- `--clip`: the bbox alone drags in France, Poland and the North Sea; the
  atlas outline keeps it to Germany.
- One run writes all years; the cell universe is the union of everything
  ever lit, so buffers of different years line up.

## Data: the 8-bit mosaic (demo only)

The Earth Observatory's openly downloadable Black Marble mosaics are
**visualisations**, not measurements — 8-bit, saturated in city cores, only
3 km. They run through the same pipeline for an offline demo:

    curl -o downloads/BlackMarble_2016_3km_geo.tif \
      https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km_geo.tif

    PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m blackmarble.pipeline \
      --input downloads/BlackMarble_2016_3km_geo.tif --year 2016 \
      --resolutions 7 --floor 15 \
      --clip ../../apps/web/public/data/boundary.json \
      --label "Night light" --spatial-resolution 3000 \
      --out ../../apps/web/public/data/afterdark

Its metric carries no unit; `--floor 15` drops the composite's low values
(~9–17), which are floor and airglow.

Then `npm run build:manifest`, which rebuilds the manifest with every
pipeline dataset it finds.

## Tests

    PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m unittest discover -s tests -t .

The VNP46A4 reader is tested against a synthetic tile (geometry, scale,
fill, quality mask, floor) and a two-year end-to-end run.
