# Marktstammdatenregister pipeline

Turns the wind turbines of the Marktstammdatenregister (MaStR, the
Bundesnetzagentur's register of every generation unit) into the atlas
binary format: H3 cells, installed wind power in MW standing at the end of
each year from 1990 on, stats, `dataset.json`. Every year is a metric
`wind_mw_<year>`; the app's WIND mode binds to the years present and plays
them on the timeline.

## Data

The register publishes a full export (`Gesamtdatenexport_<date>_<v>.zip`,
~3 GB, refreshed daily) with hundreds of XML files. The pipeline reads just
`EinheitenWind.xml` (~200 MB, 8 MB compressed) **straight out of the zip
over HTTP range requests** — the whole archive is never downloaded. A local
zip works too (`--zip`).

- Only units with public coordinates are used, and a position is never
  invented from a municipality centroid; that is nearly every turbine.
- Standing at year end = commissioned by then, not finally shut down
  before, and not merely planned. Temporarily shut-down units count as
  installed; a unit marked *finally* shut down whose export names no
  shutdown date counts in no year at all — it is certainly not standing
  now, and there is no year its shutdown can be placed in.
- The series stops at the last **complete** year (`--last-year` overrides).
  Running in August and counting "this year" put eight months of data on
  the end of the timeline labelled as a full one, and dated the dataset to
  a 31 December that had not happened.
- Capacity is `Bruttoleistung` (kW in the register, MW here); cells sum.
- Offshore parks stay in — the bbox reaches into the North Sea and Baltic.
  `--onshore-only` drops them.

Licence: Datenlizenz Deutschland – Namensnennung – Version 2.0. The
attribution travels in `dataset.json` and stays visible in the app.

## Run

Uses the census pipeline's binary writer and its venv (`h3` is all it needs
beyond the stdlib):

    cd pipelines/mastr
    PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m mastr.pipeline \
      --resolutions 8,7 --out ../../apps/web/public/data/energy

    # or from a zip you already have
    ... -m mastr.pipeline --zip downloads/Gesamtdatenexport_20260818_26.1.zip --out ...

Then `npm run build:manifest`.

A run on 26 August 2026 read 42,119 turbines with coordinates and wrote 36
years (1990–2025), 77.8 GW standing in 2025, 16,427 r8 cells, 4 MB. The
register is refreshed daily, so the counts drift between runs.

## Tests

    PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m unittest discover -s tests -t .

Covers the range-zip reader (deflate, stored, zip64 records), the unit
parser and an end-to-end run on a synthetic export.
