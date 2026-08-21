# DWD pipeline (RAIN)

Turns the Deutscher Wetterdienst's gridded annual precipitation into the
atlas binary format: H3 cells, mean rainfall in mm per cell and year,
stats, `dataset.json`. Every year is a metric `rain_mm_<year>`; the app's
RAIN mode binds to the years present and plays them on the timeline.

## Data

The CDC (Climate Data Center) publishes 1 km grids for Germany, one file
per year, from **1881** on — no login, no token:

    https://opendata.dwd.de/climate_environment/CDC/grids_germany/annual/precipitation/

They are gzipped ESRI ASCII rasters in DHDN / Gauss-Krüger zone 3
(EPSG:31467), already clipped to Germany (everything outside is `-999`),
about 570 KB per year. Cell centres are reprojected to WGS84 with pyproj,
one raster row at a time.

- Aggregation is a **mean** weighted by pixel count: rainfall is a depth,
  two 1 km pixels of 800 mm do not make 1600 mm. Pooling to r7 weights by
  how many pixels each cell was built from, never a mean of means.
- A cell without a reading is **missing** (NaN), not 0 mm.
- The country LOD is **r7** (~5 km² cells, 77,797 of them, 311 KB per
  year): the app loads every metric of a dataset up front. **r8** (358,303
  cells — Germany is 357,588 km², so one cell per source pixel) is written
  as a tiled LOD and streamed on zoom.

Licence: Creative Commons Attribution 4.0 (CC BY 4.0), not the Datenlizenz
Deutschland — see `opendata.dwd.de/climate_environment/CDC/Terms_of_use.txt`
beside the data, and `dwd.de/DE/service/rechtliche_hinweise`. The source must
be named and modifications indicated; the manifest carries the credit into
the app.

## Run

Uses the census pipeline's binary and tiled writers and its venv (pyproj is
already a dependency there; `certifi` supplies the CA bundle, see below):

```bash
cd pipelines/dwd
PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m dwd.pipeline \
  --years 2001-2025 --out ../../apps/web/public/data/rain

# then fold the r8 tiles into one file per tile, and rebuild the manifest
cd ../zensus
.venv/Scripts/python -m zensus_pipeline.pack --lod ../../apps/web/public/data/rain/r8
cd ../.. && npm run build:manifest
```

About 2.5 s per year plus the packing. `--years 1881-2025` is available but
would be 145 metrics; the app fetches all of them at country level, so keep
the range to what the timeline should play (25 years ≈ 8 MB).

Other CDC variables on the same grid work through the same code, e.g.
`--variable air_temperature_mean --metric-prefix temp_c --unit "°C"
--scale 0.1 --label "Mean air temperature"` (that one ships tenths of a
degree, hence `--scale`).

## Tests

    PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m unittest discover -s tests -t .

Header parsing, NODATA, north-first row order, the reprojection landing
inside Germany, mean-not-sum, weighted pooling, and an end-to-end run on a
synthetic 3 × 2 grid. The reprojection tests skip themselves when pyproj is
missing (as in CI).

## Note on TLS

`opendata.dwd.de` serves a chain whose root Windows only fetches on demand,
so a plain `urlopen` can fail there with `CERTIFICATE_VERIFY_FAILED` while
`curl` succeeds. The downloader uses `certifi`'s bundle when it is
installed and the default context otherwise.
