#!/usr/bin/env node
// Assembles apps/web/public/data/manifest.json from every pipeline output
// under public/data/<dataset>/dataset.json, plus the city labels and the
// country outline the renderer draws. Run after any pipeline run:
//   node scripts/build-manifest.mjs
// Usage: node scripts/build-manifest.mjs [outDir]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, GERMANY } from './germany.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'apps', 'web', 'public', 'data');

// Pipeline outputs, in display order. Each owns its own cell universe.
const DATASETS = ['zensus', 'afterdark', 'energy', 'rain', 'land', 'forest'];

/** Every URL of one level of detail carries this key. */
const URL_KEYS = [
  'positions',
  'metricTemplate',
  'tileIndex',
  'tileTemplate',
  'positionsTemplate',
  'tilePackTemplate',
];

/** A short stamp for everything under `dir`, from each file's path, size and
 *  modification time. Hashing the bytes would mean reading hundreds of
 *  megabytes; a pipeline run always rewrites the files, so the metadata is
 *  enough to notice. It errs towards changing when nothing did, which costs a
 *  re-download — never towards staying the same when something did.
 *
 *  No dot in the output: the tile worker reads a pack section name out of a
 *  filename by splitting on dots. */
function stampOf(dir) {
  const hash = createHash('sha256');
  const walk = (at, rel) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = join(at, entry.name);
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, name);
        continue;
      }
      // dataset.json is the description, not the data; including it would
      // make every manifest build change the stamp it is computing
      if (name === 'dataset.json') continue;
      const s = statSync(full);
      hash.update(`${name}:${s.size}:${Math.round(s.mtimeMs)}\n`);
    }
  };
  walk(dir, '');
  return hash.digest('hex').slice(0, 10);
}

/** Pipeline output with URLs rebased for the app and stamped with a version.
 *
 *  The stamp is what stops a stale metric buffer being read beside a fresh
 *  positions buffer. Buffers of one level are index-aligned: pair yesterday's
 *  values with today's cells and every number lands on the wrong hexagon — a
 *  plausible map that is quietly wrong, which is worse than a broken one.
 *  One stamp per level means all of its URLs change together or none do. */
function loadDataset(dir) {
  const path = join(OUT, dir, 'dataset.json');
  if (!existsSync(path)) return null;
  const dataset = JSON.parse(readFileSync(path, 'utf8'));
  const rebase = (p) => (p && !p.startsWith('/') ? `/data/${dir}/${p}` : p);
  for (const lod of dataset.lods ?? []) {
    const lodDir = join(OUT, dir, `r${lod.resolution}`);
    const stamp = existsSync(lodDir) ? stampOf(lodDir) : null;
    for (const key of URL_KEYS) {
      if (!lod[key]) continue;
      const url = rebase(lod[key]);
      // `{metric}` and `{tile}` are substituted into the path, which ends
      // before the query, so the placeholders still resolve.
      lod[key] = stamp ? `${url}?v=${stamp}` : url;
    }
    if (stamp) lod.version = stamp;
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
