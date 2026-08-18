# Black Marble pipeline

Turns NASA Black Marble night-light rasters into the atlas binary format
(H3 cells, mean brightness per cell, stats, `dataset.json`).

## Data

The openly downloadable mosaics are 8-bit **visualisations**, not
calibrated radiance — the metric is therefore called `light_brightness`
and carries no unit. Calibrated `VNP46A3` radiance requires an Earthdata
login; that GeoTIFF runs through the same pipeline with
`--metric night_radiance --unit "nW/cm2/sr"`.

    curl -o downloads/BlackMarble_2016_3km_geo.tif \
      https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km_geo.tif

## Run

Uses the census pipeline's binary writer and its venv (`rasterio` on top):

    cd pipelines/black-marble
    ../zensus/.venv/Scripts/pip install rasterio
    PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m blackmarble.pipeline \
      --input downloads/BlackMarble_2016_3km_geo.tif \
      --resolutions 7 --floor 15 \
      --clip ../../apps/web/public/data/boundary.json \
      --label "Night-light brightness 2016" \
      --out ../../apps/web/public/data/afterdark

- `--clip`: the bbox alone drags in France, Poland and the North Sea; the
  atlas outline keeps it to Germany.
- `--floor 15`: the composite's low values (~9–17) are sensor floor and
  airglow, not settlement — half of all cells sit there. The floor keeps
  towns and cities and leaves rural darkness dark.
- Aggregation is a **mean** weighted by pixel count (plan §92): radiance is
  an intensity, two neighbouring pixels of 30 do not make 60.

Then `npm run generate:demo` once, which rebuilds the manifest with every
pipeline dataset it finds.

## Tests

    PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m unittest discover -s tests -t .
