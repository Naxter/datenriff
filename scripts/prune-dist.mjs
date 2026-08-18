#!/usr/bin/env node
// Drops the whole-LOD buffers of tiled LODs from the build output. The app
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
console.log(`pruned ${removed} whole-LOD files of tiled LODs (${(bytes / 1e6).toFixed(0)} MB) from ${DATA}`);
