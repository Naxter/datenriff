# Black Marble pipeline

Turns NASA Black Marble night lights into the atlas binary format: H3
cells, mean radiance per cell and year, stats, `dataset.json`. Every year
becomes a metric `light_<year>`; the app shows the latest year and offers a
timeline when there are several.

## Data: VNP46A4 (the real thing)

`VNP46A4` is the calibrated annual composite: 500 m pixels, annual
nighttime radiance in nW/cm²/sr as float32, with a per-pixel quality flag,
from 2012 on. Germany needs the four tiles h18v03, h18v04, h19v03, h19v04
per year (~560 MB a year, ~7.8 GB for 2012–2025).

Access needs a free NASA Earthdata account:

1. Register at https://urs.earthdata.nasa.gov, then Profile → *Generate
   Token* and copy it.
2. Put it in `EARTHDATA_TOKEN`: either the environment (PowerShell:
   `$env:EARTHDATA_TOKEN="..."`) or a `.env` file in the repo root, which
   is git-ignored. Never write it into a tracked file.
3. Run the pipeline; missing tiles are downloaded into `--tiles-dir`.
   Files fetched by hand work too — the reader only needs them in that
   directory, whatever their production stamp.

Granules are located through CMR, the Earthdata catalogue, and pulled from
the Earthdata Cloud bucket CMR points to. The old LAADS archive path
(`/archive/allData/5000/VNP46A4/<year>/001/`) is gone: collection 002 sits
in archive set 5200 and is served from `data.laadsdaac.earthdatacloud.nasa.gov`.
A bearer token against the old host answers 401 whatever the token, which
looks like an authentication problem and is not one.

```bash
cd pipelines/black-marble
../zensus/.venv/Scripts/pip install h5py
PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m blackmarble.pipeline \
  --vnp46 --years 2012-2025 --tiles-dir downloads/vnp46a4 \
  --resolutions 8,7 --tiled 8 --floor 0.5 --unit "nW/cm²/sr" \
  --clip ../../apps/web/public/data/boundary.json \
  --label "Night light" \
  --out ../../apps/web/public/data/afterdark
```

- `--floor 0.5`: radiance at or below this is sensor floor / airglow, not
  settlement. Sub-floor pixels are kept as 0, so a genuinely dark year
  reads as 0; a cell whose every pixel was fill or quality-masked in a
  year has no measurement and is written as missing (NaN), not as dark.
- Quality: good (0) and gap-filled (2) pixels are kept, poor ones (1: too
  few clear nights) dropped. `--keep-quality 0,1,2` keeps everything.
- Aggregation is a **mean** weighted by pixel count: radiance is
  an intensity, two neighbouring pixels of 30 do not make 60.
- `--clip`: the bbox alone drags in France, Poland and the North Sea; the
  atlas outline keeps it to Germany.
- One run writes all years; the cell universe is the union of everything
  ever lit, so buffers of different years line up.
- `--tiled 8`: r8 is written as tiles and streamed on zoom. The app loads
  every metric of the country LOD up front, so the country LOD stays r7 —
  fourteen years of r8 would be tens of megabytes at start-up.
- The catalogue window for a year also returns the previous year's
  granule, whose coverage ends on 1 January: the downloader matches
  `A<year>001` in the name instead of trusting the order.

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
