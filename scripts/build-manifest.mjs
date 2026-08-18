#!/usr/bin/env node
// Assembles apps/web/public/data/manifest.json from every pipeline output
// under public/data/<dataset>/dataset.json, plus the city labels and the
// country outline the renderer draws. Run after any pipeline run:
//   node scripts/build-manifest.mjs
// Usage: node scripts/build-manifest.mjs [outDir]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'apps', 'web', 'public', 'data');

// Pipeline outputs, in display order. Each owns its own cell universe.
const DATASETS = ['zensus', 'afterdark'];

// Country outline (lon, lat) for the faint boundary line and for clipping
// raster sources; the census cells themselves come from the official grids.
const GERMANY = [
  [7.19, 53.31], [6.99, 53.36], [7.29, 53.68], [8.02, 53.71], [8.36, 53.6],
  [8.55, 53.53], [8.62, 53.88], [8.9, 53.83], [8.83, 54.03], [8.6, 54.33],
  [8.57, 54.75], [8.66, 54.91], [9.44, 54.83], [9.98, 54.7], [10.03, 54.5],
  [10.14, 54.33], [10.75, 54.31], [11.09, 54.53], [11.24, 54.4], [10.9, 54.1],
  [11.24, 54.0], [11.46, 54.15], [12.1, 54.18], [12.52, 54.47], [12.9, 54.44],
  [13.4, 54.65], [13.76, 54.54], [13.83, 54.11], [14.2, 53.92], [14.3, 53.55],
  [14.14, 52.97], [14.64, 52.57], [14.55, 52.35], [14.6, 52.27], [14.76, 51.55],
  [14.98, 51.33], [14.83, 50.87], [14.3, 50.88], [13.9, 50.75], [13.03, 50.42],
  [12.32, 50.26], [12.4, 49.97], [12.55, 49.92], [12.4, 49.75], [12.66, 49.43],
  [12.79, 49.21], [13.4, 48.98], [13.84, 48.77], [13.44, 48.56], [13.03, 48.26],
  [12.93, 48.21], [12.76, 48.12], [13.0, 47.85], [13.08, 47.7], [12.78, 47.67],
  [12.24, 47.69], [11.63, 47.59], [11.27, 47.4], [10.98, 47.4], [10.7, 47.55],
  [10.28, 47.27], [9.97, 47.5], [9.55, 47.54], [9.17, 47.66], [8.87, 47.65],
  [8.6, 47.8], [8.2, 47.62], [7.59, 47.56], [7.51, 47.9], [7.57, 48.3],
  [7.8, 48.59], [8.23, 48.97], [7.94, 49.05], [7.45, 49.17], [7.0, 49.11],
  [6.56, 49.42], [6.38, 49.47], [6.12, 49.6], [6.14, 50.13], [6.4, 50.32],
  [6.01, 50.76], [6.09, 50.92], [5.96, 51.04], [6.17, 51.34], [6.09, 51.6],
  [5.95, 51.83], [6.41, 51.83], [6.83, 51.97], [7.07, 52.24], [7.07, 52.4],
  [6.71, 52.63], [7.05, 52.64], [7.21, 53.01],
];

// name, lon, lat, label tier (1 = always visible; higher tiers appear on zoom)
const CITIES = [
  ['Berlin', 13.405, 52.52, 1],
  ['Hamburg', 9.99, 53.55, 1],
  ['München', 11.575, 48.14, 1],
  ['Köln', 6.96, 50.94, 1],
  ['Frankfurt am Main', 8.68, 50.11, 1],
  ['Stuttgart', 9.18, 48.78, 1],
  ['Düsseldorf', 6.78, 51.23, 1],
  ['Leipzig', 12.37, 51.34, 1],
  ['Dortmund', 7.47, 51.51, 2],
  ['Essen', 7.01, 51.46, 2],
  ['Bremen', 8.8, 53.08, 1],
  ['Dresden', 13.74, 51.05, 1],
  ['Hannover', 9.73, 52.37, 1],
  ['Nürnberg', 11.08, 49.45, 1],
  ['Duisburg', 6.76, 51.43, 3],
  ['Bochum', 7.22, 51.48, 3],
  ['Wuppertal', 7.15, 51.26, 3],
  ['Bielefeld', 8.53, 52.03, 2],
  ['Bonn', 7.1, 50.73, 2],
  ['Münster', 7.63, 51.96, 2],
  ['Karlsruhe', 8.4, 49.01, 2],
  ['Mannheim', 8.47, 49.49, 2],
  ['Augsburg', 10.9, 48.37, 2],
  ['Wiesbaden', 8.24, 50.08, 3],
  ['Kiel', 10.14, 54.32, 2],
  ['Aachen', 6.08, 50.78, 3],
  ['Braunschweig', 10.52, 52.26, 3],
  ['Chemnitz', 12.92, 50.83, 3],
  ['Halle (Saale)', 11.97, 51.48, 3],
  ['Magdeburg', 11.63, 52.13, 2],
  ['Freiburg', 7.85, 47.99, 2],
  ['Krefeld', 6.56, 51.33, 3],
  ['Lübeck', 10.69, 53.87, 3],
  ['Mainz', 8.27, 50.0, 3],
  ['Erfurt', 11.03, 50.98, 2],
  ['Rostock', 12.1, 54.09, 2],
  ['Kassel', 9.5, 51.31, 3],
  ['Potsdam', 13.06, 52.4, 3],
  ['Saarbrücken', 7.0, 49.23, 2],
  ['Oldenburg', 8.21, 53.14, 3],
  ['Osnabrück', 8.05, 52.28, 3],
  ['Regensburg', 12.1, 49.02, 3],
  ['Ulm', 9.99, 48.4, 3],
  ['Würzburg', 9.93, 49.79, 3],
  ['Jena', 11.59, 50.93, 3],
];

/** Pipeline output with URLs rebased for the app. */
function loadDataset(dir) {
  const path = join(OUT, dir, 'dataset.json');
  if (!existsSync(path)) return null;
  const dataset = JSON.parse(readFileSync(path, 'utf8'));
  const rebase = (p) => (p && !p.startsWith('/') ? `/data/${dir}/${p}` : p);
  for (const lod of dataset.lods ?? []) {
    for (const key of ['positions', 'metricTemplate', 'tileIndex', 'tileTemplate', 'positionsTemplate']) {
      if (lod[key]) lod[key] = rebase(lod[key]);
    }
  }
  return dataset;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const datasets = DATASETS.map(loadDataset).filter(Boolean);
  if (datasets.length === 0) {
    console.error(
      `No pipeline output found under ${OUT}.
Run a pipeline first — see pipelines/zensus/README.md.`,
    );
    process.exit(1);
  }
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    datasets,
    labels: '/data/cities.json',
    boundary: '/data/boundary.json',
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(OUT, 'cities.json'),
    JSON.stringify(CITIES.map(([name, lon, lat, tier]) => ({ name, lon, lat, tier })), null, 2),
  );
  writeFileSync(join(OUT, 'boundary.json'), JSON.stringify({ rings: [GERMANY] }));
  for (const d of datasets) console.log(`${d.id}: ${d.metrics.length} metrics, LODs ${d.lods.map((l) => l.resolution).join('/')}`);
  console.log(`Wrote ${join(OUT, 'manifest.json')}`);
}

main();
