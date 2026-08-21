#!/usr/bin/env node
// Drops what the deployed site never fetches: the whole-LOD buffers of tiled
// LODs, plus the pipelines' own bookkeeping (cells.txt, dataset.json). The app
// only ever fetches a tiled LOD's index and its tiles; the whole-LOD files
// (cells.txt, positions.bin, one buffer per metric) exist for the pipeline's
// own alignment across runs. At r10 they are 150 MB, and cells.txt alone is
// past a static host's per-file limit. Run after `vite build`, before deploy.
//
// Usage: node scripts/prune-dist.mjs [dist/data dir]

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.argv[2] ?? join(ROOT, 'apps', 'web', 'dist', 'data');

const manifestPath = join(DATA, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`no manifest at ${manifestPath} — build first`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
let removed = 0;
let bytes = 0;
for (const dataset of manifest.datasets) {
  for (const lod of dataset.lods) {
    if (!lod.tileIndex) continue;
    const dir = join(DATA, dataset.id, `r${lod.resolution}`);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory() || name === 'index.json') continue;
      bytes += statSync(p).size;
      rmSync(p);
      removed += 1;
    }
  }
}
// Bookkeeping the app never fetches: cells.txt is the pipeline's cell order,
// kept so a later run can align to it, and dataset.json is merged into the
// manifest at build time. Neither is referenced from the manifest, and
// together they are ~11.6 MB uploaded on every deploy.
for (const dataset of manifest.datasets) {
  const dsDir = join(DATA, dataset.id);
  if (!existsSync(dsDir)) continue;
  const strays = [join(dsDir, 'dataset.json')];
  for (const lod of dataset.lods) strays.push(join(dsDir, `r${lod.resolution}`, 'cells.txt'));
  for (const p of strays) {
    if (!existsSync(p) || statSync(p).isDirectory()) continue;
    bytes += statSync(p).size;
    rmSync(p);
    removed += 1;
  }
}

console.log(`pruned ${removed} files the site never fetches (${(bytes / 1e6).toFixed(0)} MB) from ${DATA}`);
