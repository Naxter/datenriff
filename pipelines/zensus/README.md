# Census pipeline

Turns the official Destatis grid data (Census 2022 / 2011, 100 m, EPSG:3035)
into the canonical binary format of the Vertical Atlas:

```
CSV → clean special values → centroid → EPSG:3035 → WGS84
    → H3 res 10 → aggregate res 9 / res 8 → stats → binary + manifest
```

## Installation

```bash
cd pipelines/zensus
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

## Getting the data

Census 2022 — population counts in grid cells (100 m) — and Census 2011 —
inhabitants in the 100 m grid — are available from the Destatis census pages:
<https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Zensus2022/_inhalt.html>

The ZIPs each contain a CSV with columns such as
`GITTER_ID_100m;x_mp_100m;y_mp_100m;Einwohner` (delimiter `;`). Both flavours
of georeference are supported: explicit centre columns (`x_mp_*`/`y_mp_*`) or
the INSPIRE grid id (`CRS3035RES100mN…E…`, lower left corner).

## Running

```bash
# Population 2022 — defines the cell universe
python -m zensus_pipeline.pipeline \
  --input downloads/Zensus2022_Bevoelkerungszahl_100m-Gitter.csv \
  --metric population_2022 --label "Population 2022" \
  --source-url "<exact download URL>" --download-date 2026-08-18 \
  --out ../../apps/web/public/data/zensus

# Population 2011 — aligned to the same universe
python -m zensus_pipeline.pipeline \
  --input downloads/Zensus_Bevoelkerung_100m-Gitter.csv \
  --metric population_2011 --label "Population 2011" \
  --out ../../apps/web/public/data/zensus

# Mean age — weighted mean, weights from the population file
python -m zensus_pipeline.pipeline \
  --input downloads/Zensus2022_Durchschnittsalter_100m-Gitter.csv \
  --rule wmean --value-column Durchschnittsalter \
  --weight-input downloads/Zensus2022_Bevoelkerungszahl_100m-Gitter.csv \
  --weight-value-column Einwohner \
  --metric age_mean --label "Mean age" --unit years \
  --out ../../apps/web/public/data/zensus

# Vacancy — share, pooling numerator and denominator (never mean of ratios)
python -m zensus_pipeline.pipeline \
  --input downloads/Zensus2022_Leerstandsquote_100m-Gitter.csv \
  --rule share \
  --numerator-column Leerstehend --denominator-column Wohnungen \
  --min-denominator 25 \
  --metric vacancy_rate --label "Vacancy rate" \
  --out ../../apps/web/public/data/zensus

# Heating — dominant category plus dominance from count columns
# (check the column names in the CSV header first)
python -m zensus_pipeline.pipeline \
  --input downloads/Zensus2022_Heizungsart_100m-Gitter.csv \
  --rule category \
  --category-columns "Gas,Heizoel,Fernwaerme,Waermepumpe,Strom,Holz_Pellets" \
  --category-labels "Gas,Oil,District heating,Heat pump,Electricity,Biomass" \
  --metric heating --label "Heating energy carrier" \
  --out ../../apps/web/public/data/zensus
```

`wmean` with `--weight-input` loads the weight file into a dictionary (joined
on the grid id) — a few hundred MB of RAM at ~3 million cells. Use
`--weight-column` instead when the weight is a column in the same file.

Output:

```
apps/web/public/data/zensus/
├── dataset.json        # manifest fragment including provenance (hash, date, commit)
├── r8/                 # country LOD
│   ├── cells.txt       # canonical H3 cell order
│   ├── positions.bin   # float32 [lon, lat]
│   ├── population_2022.f32
│   └── population_2011.f32
└── r9/                 # regional LOD (tiling still to come)
```

Afterwards point `apps/web/public/data/manifest.json` at the new dataset
(prefix the paths with `/data/zensus/`) — the renderer needs no change. Until
then the app runs on the synthetic demo dataset from
`scripts/generate-demo-data.mjs`.

## Rules

- **Suppression is not zero**: special tokens (`–`, `.`, `x`, …) are treated as
  *missing* and never enter sums.
- **Aggregate by semantics**: counts → SUM; averages → weighted mean; shares →
  SUM(numerator)/SUM(denominator); categories → category sums + argmax +
  dominance. Implemented in `aggregate.py`.
- **Suppress small denominators**: `change_pct` returns `None` below the
  minimum denominator, which the front end renders as "suppressed".
- **Reproducibility**: every run writes source, SHA-256, download date,
  pipeline version and git commit into `dataset.json`.

## Tests

The correctness-critical modules (grid ids, special values, aggregation,
binary writer) are testable without third-party dependencies:

```bash
python3 -m unittest discover -s tests -t . -v      # from pipelines/zensus/
```

## Status

- [x] SUM metrics (population 2022/2011) end to end
- [x] wmean (AGE, RENT) and category metrics (HEATING) in the CLI
- [x] share metrics (vacancy, share ≥65) in the CLI
- [ ] r9/r10 tiling by H3 parent
- [ ] download automation with hash pinning
