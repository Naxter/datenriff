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

# Population 2011 — aligned to the same universe. The 2011 grid marks
# uninhabited/suppressed cells with -1, which must stay missing:
python -m zensus_pipeline.pipeline \
  --input downloads/Zensus2011_Einwohnerzahl_100m_Gitter.csv \
  --metric population_2011 --label "Population 2011" \
  --treat-missing "-1" \
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

# Homes and rent come from one file: dwelling count as SUM, rent as the
# dwelling-weighted mean
python -m zensus_pipeline.pipeline \
  --input downloads/.../Zensus2022_Durchschn_Nettokaltmiete_Anzahl_der_Wohnungen_100m-Gitter.csv \
  --rule sum --value-column AnzahlWohnungen \
  --metric homes --label "Homes" \
  --out ../../apps/web/public/data/zensus
python -m zensus_pipeline.pipeline \
  --input downloads/.../Zensus2022_Durchschn_Nettokaltmiete_Anzahl_der_Wohnungen_100m-Gitter.csv \
  --rule wmean --value-column durchschnMieteQM --weight-column AnzahlWohnungen \
  --metric rent --label "Net cold rent" --unit "€/m²" \
  --out ../../apps/web/public/data/zensus

# Heating — dominant category plus dominance from count columns. The
# Energieträger CSV ships as cp1252, not UTF-8:
python -m zensus_pipeline.pipeline \
  --input downloads/Zensus2022_Energietraeger_100m-Gitter.csv \
  --rule category --encoding cp1252 \
  --category-columns "Gas,Heizoel,Fernwaerme,Solar_Geothermie_Waermepumpen,Strom,Holz_Holzpellets,Kohle" \
  --category-labels "Gas,Heizöl,Fernwärme,Wärmepumpe,Strom,Biomasse,Kohle" \
  --metric heating --label "Heating energy source" \
  --out ../../apps/web/public/data/zensus
```

`wmean` with `--weight-input` loads the weight file into a dictionary (joined
on the grid id) — a few hundred MB of RAM at ~3 million cells. Use
`--weight-column` instead when the weight is a column in the same file.

Output:

```
apps/web/public/data/zensus/
├── dataset.json        # manifest fragment including provenance (hash, date, commit)
├── r7/                 # country LOD for the mobile quality profile
├── r8/                 # country LOD for desktop
│   ├── cells.txt       # canonical H3 cell order
│   ├── positions.bin   # float32 [lon, lat]
│   ├── population_2022.f32
│   └── population_2011.f32
└── r9/                 # regional LOD, tiled by H3 r5 parent + index.json
```

After the last metric run, pack the tiled LOD (one file per tile instead of
one per tile and metric — 1,724 files instead of 19,000; re-run it whenever
a metric is added):

    .venv/Scripts/python -m zensus_pipeline.pack --lod ../../apps/web/public/data/zensus/r9

Then run `npm run build:manifest` once — it assembles
`apps/web/public/data/manifest.json` from every pipeline output it finds,
plus the city labels and the country outline.

## Notes on the V1.1 metrics

- **Vacancy** is published as a *rate*, not as numerator and denominator, so
  it cannot use the share rule. It aggregates as a dwelling-weighted mean
  (`--weight-input` the dwellings file).
- **Built 2014 or later** is a genuine share (`a2014und_spaeter` over
  `Insgesamt_Wohnungen`). Destatis rounds cell values independently, so a
  few tiny cells report slightly above 100 %; the mode's colour domain clips
  them.
- **Household size** is a population-weighted mean. The exact aggregate
  would be persons ÷ households (a harmonic mean of the cell means);
  households are not published per cell, so this is an approximation and the
  label says "average household size", not a count of households.
- The building-age archive is **7-Zip** despite its `.zip` name.

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

- [x] SUM metrics (population 2022/2011) end to end with real data
- [x] wmean (AGE, RENT) and category metrics (HEATING) in the CLI
- [x] share metrics in the CLI (share of dwellings built 2014+)
- [x] r9 (and optional r10) tiling by H3 parent with a bounds index
- [ ] download automation with hash pinning
