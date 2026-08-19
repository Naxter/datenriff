# CLC5 pipeline (LAND)

Turns BKG's CORINE Land Cover 5 ha into the atlas binary format: H3 cells,
the artificial share and the dominant land cover per cell, stats,
`dataset.json`.

## Data

CLC5 is CORINE Land Cover for Germany with a 5 ha minimum mapping unit,
published by the Bundesamt für Kartographie und Geodäsie for **2012, 2015,
2018 and 2021**. Open data, no login, "Datenlizenz Deutschland –
Namensnennung – Version 2.0" — the source must be named, and the app does
that as long as the mode is on screen.

```bash
cd pipelines/clc5
curl -o downloads/clc5_2021.utm32s.gpkg.zip \
  https://daten.gdz.bkg.bund.de/produkte/dlm/clc5_2021/aktuell/clc5_2021.utm32s.gpkg.zip
python -c "import zipfile; zipfile.ZipFile('downloads/clc5_2021.utm32s.gpkg.zip').extractall('downloads')"
```

1.5 GB compressed, 5.4 GB as a GeoPackage: 657,676 multipolygons in
EPSG:25832 with a three-digit CORINE code.

Only 2021 is published as a GeoPackage; 2012, 2015 and 2018 are
shapefiles, and each of those is split into five files, one per class
group. They are **converted once** rather than parsed, so the pipeline
only ever reads one format and one layer:

```bash
../zensus/.venv/Scripts/pip install pyogrio     # brings its own GDAL
curl -o downloads/clc5_2012.utm32s.shape.zip \
  https://daten.gdz.bkg.bund.de/produkte/dlm/clc5_2012/aktuell/clc5_2012.utm32s.shape.zip
python -c "import zipfile; zipfile.ZipFile('downloads/clc5_2012.utm32s.shape.zip').extractall('downloads')"
PYTHONPATH="." ../zensus/.venv/Scripts/python -m clc5.convert \
  --input downloads/clc5_2012.utm32s.shape/clc5/clc5_class?xx.shp \
  --out downloads/clc5_2012.gpkg --layer clc5 --columns CLC12
```

`clc5/convert.py` is the only file in the repo that needs GDAL, and it is
a tool: nothing in the pipeline imports it. Converting also sidesteps the
shapefile hole rule — a shapefile marks a hole by the direction its ring
winds, WKB by the ring's position, and reading that wrong turns a lake
inside a forest into forest.

## Run

```bash
PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m clc5.pipeline \
  --input downloads/clc5_2021/CLC5ha_2021.gpkg --year 2021 \
  --out ../../apps/web/public/data/land
# an older vintage, once converted; the layer and column names differ
PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m clc5.pipeline \
  --input downloads/clc5_2012.gpkg --year 2012 --table clc5 --attribute CLC12 \
  --out ../../apps/web/public/data/land
cd ../zensus && .venv/Scripts/python -m zensus_pipeline.pack \
  --lod ../../apps/web/public/data/land/r8
cd ../.. && npm run build:manifest
```

About 25 minutes for the whole country. Then pack the tiles — an unpacked
tiled LOD is one file per tile per metric, which the deploy notices.

## How the numbers are made

- **Area is counted, not integrated.** Each polygon is covered with H3 r10
  cells (~0.015 km²) whose centre falls inside it, and every fine cell is
  one unit of area for its class. An r8 output cell holds 49 of them, so
  the share it reports moves in steps of about two percent. CLC5's
  smallest polygon is 5 ha — roughly 33 fine cells — so nothing in the
  source is too small to be counted.
- **`built_share_<year>` is CORINE level 1 class 1**, "artificial
  surfaces" (codes 111–142). That includes urban green and sport grounds:
  a park is artificial land cover but it is not sealed, which is why the
  metric is labelled *artificial surface* and not *sealed*.
- **`land_class_<year>` is the dominant one of eight groups**
  (`classes.py`). The full nomenclature has 35 classes in Germany, more
  than a categorical palette can carry; the groups are the bands a viewer
  can name at a glance. `land_class_dominance_<year>` carries how much of
  the cell that winner covers, which the renderer uses to pale out mixed
  cells.
- **The country LOD is r7 and r8 is written as tiles**, as with RAIN and
  AFTER DARK: the app loads every metric of the country LOD up front.
- Shares are fractions of 1, like every other share in the atlas.

## Reading a GeoPackage without GDAL

A GeoPackage is a SQLite database. Geometry cells hold a short header
(magic `GP`, flags, srs id, an optional envelope) and then plain WKB, so
`gpkg.py` reads them with `sqlite3` and `struct` and hands back numpy
arrays. That keeps the pipeline on the standard library plus numpy,
h3 and pyproj — the alternative is a GDAL wheel for one file format.

Only Polygon (WKB 3) and MultiPolygon (WKB 6) are implemented; anything
else raises instead of guessing.

## Tests

    PYTHONPATH=".;../zensus" ../zensus/.venv/Scripts/python -m unittest discover -s tests -t .

The tests build their own GeoPackage with `sqlite3`, so they need no
download: WKB in both byte orders, a polygon with a hole, an envelope in
the header, the class grouping, H3 coverage of a block near Kassel, and an
end-to-end run that checks a cell on the seam between two covers reports a
partial share.
