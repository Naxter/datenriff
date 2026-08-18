# Datenriff — Vertical Atlas Germany

Germany, rebuilt out of data. Every spatial cell becomes a vertical column:
height carries a quantity, colour carries a property, time lets the landscape
grow and shrink. Not a dashboard and not a GIS — an interactive data atlas
with the feel of a printed poster.

![Vertical Atlas — People](docs/media/hero-people.png)

*Rendered from the prototype using the synthetic demo dataset.*

## Quickstart

```bash
npm install
npm run dev
```

The app comes up on <http://localhost:5173>. On first start a synthetic demo
dataset is generated (deterministic, ~486k hex cells, labelled as demo data in
the UI) so the app runs without the multi-gigabyte census downloads. The real
ETL lives in [`pipelines/zensus`](pipelines/zensus/README.md).

Without the Node toolchain, the dependency-free prototype renders the same
binary data:

```bash
node scripts/generate-demo-data.mjs
npx http-server .
```

Then open <http://localhost:8080/prototype/>.

## Modes

| Mode | Height | Colour |
| --- | --- | --- |
| PEOPLE | inhabitants | inhabitants (sqrt) |
| CHANGE | inhabitants 2022 | Δ 2011→2022, with a timeline morph |
| AGE | inhabitants | mean age |
| RENT | dwellings | net cold rent €/m² |
| HEATING | dwellings | dominant energy carrier |

Planned: AFTER DARK (night lights), FAMILIES, HOMES, VACANCY, RAIN, ENERGY,
LAND, FOREST — see the [roadmap](docs/roadmap.md).

Colour ramps are an option, not a constant: switch them via the dots below the
legend or by URL (`?palette=glacier|ember|noir|…`). The prototype takes the
same parameter.

## How it works

One renderer, many data sculptures. Every source is translated offline into
the same spatial model — H3 cells at several resolutions, binary metric
buffers, one manifest:

```
Sculpture = SpatialIndex × HeightMetric × ColorMetric × Time × Style
```

```
CSV / raster                 browser
    │                            │
 clean special values      manifest.json
    │                            │
 centroid → EPSG:3035       positions.bin + <metric>.f32/.u8
    │                            │
 WGS84 → H3 r10             TargetBuilder (elevations + RGBA)
    │                            │
 aggregate r9 / r8          MorphEngine (mode + timeline morphs)
    │                            │
 stats + binary writer      deck.gl ColumnLayer (binary attributes)
```

Aggregation follows metric semantics, never a blanket average: counts sum,
averages use `SUM(value·weight) / SUM(weight)`, shares use
`SUM(numerator) / SUM(denominator)`, categories take the argmax plus a
dominance value that desaturates mixed cells. Official suppression markers are
missing values, never zero.

More detail: [architecture](docs/architecture.md) ·
[data format](docs/data-format.md).

## Repository

```
apps/web/               React + Vite + deck.gl front end (ColumnLayer, binary attributes)
packages/
  data-contracts/       dataset, LOD manifest, metric and mode contracts
  color-scales/         palettes and typed-array colour mapping
  sculpture-core/       morph engine, elevation calibration, derived metrics
pipelines/zensus/       Python ETL: Destatis 100 m grid → H3 → binary
prototype/              dependency-free WebGL2 viewer over the same binaries
scripts/                demo data generator, screenshot helper
docs/                   architecture, data format, roadmap
```

## Development

```bash
npm run generate:demo    # regenerate the synthetic demo dataset
npm run typecheck        # package builds + app tsc
npm run test             # node:test (packages) + unittest (pipeline)
npm run build            # production build of apps/web
```

The pipeline tests run against the interpreter found first: the
`pipelines/zensus/.venv` if present, otherwise `python3`/`python`/`py -3`. For
a real pipeline run install its dependencies:

```bash
python -m venv pipelines/zensus/.venv
pipelines/zensus/.venv/Scripts/pip install -e pipelines/zensus   # POSIX: .venv/bin/pip
```

The prototype in `prototype/` is the test bed for visual decisions — camera,
height calibration, lighting and shadows are tuned there by screenshot
comparison and mirrored into `apps/web`.

## Data and licence

The bundled demo dataset is synthetic and contains no real census values. It
is deterministic, so screenshots and visual comparisons are reproducible.

Target sources are Destatis (Census 2022/2011), NASA Black Marble, DWD,
Marktstammdatenregister and BKG land cover. Attribution and licence come per
dataset from the manifest and are visible in the app. Census results are
already statistically protected; the atlas shows aggregated grid cells and
makes no attempt to reconstruct individual buildings or households.

Code is MIT licensed — see [LICENSE](LICENSE).
