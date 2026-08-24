#!/usr/bin/env node
// Assembles apps/web/public/data/manifest.json from every pipeline output
// under public/data/<dataset>/dataset.json, plus the city labels and the
// country outline the renderer draws. Run after any pipeline run:
//   node scripts/build-manifest.mjs
// Usage: node scripts/build-manifest.mjs [outDir]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, GERMANY } from './germany.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'apps', 'web', 'public', 'data');

// Pipeline outputs, in display order. Each owns its own cell universe.
const DATASETS = ['zensus', 'afterdark', 'energy', 'rain', 'land', 'forest'];

/** Pipeline output with URLs rebased for the app. */
function loadDataset(dir) {
  const path = join(OUT, dir, 'dataset.json');
  if (!existsSync(path)) return null;
  const dataset = JSON.parse(readFileSync(path, 'utf8'));
  const rebase = (p) => (p && !p.startsWith('/') ? `/data/${dir}/${p}` : p);
  for (const lod of dataset.lods ?? []) {
    for (const key of ['positions', 'metricTemplate', 'tileIndex', 'tileTemplate', 'positionsTemplate', 'tilePackTemplate']) {
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
    // state outlines for FOCUS (scripts/fetch-states.mjs); optional
    ...(existsSync(join(OUT, 'states.json')) ? { states: '/data/states.json' } : {}),
    // national outline for the optional border (same script); optional
    ...(existsSync(join(OUT, 'outline.json')) ? { outline: '/data/outline.json' } : {}),
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
