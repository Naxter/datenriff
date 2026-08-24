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
import { join, dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(process.argv[2] ?? join(ROOT, 'apps', 'web', 'dist', 'data'));

// This script deletes. Every path it deletes is built from strings in
// manifest.json, and a manifest is a generated file that could be malformed
// or hand-edited — an id of "../.." would walk out of the build and take
// something else with it. Ids are therefore checked against what a pipeline
// can actually produce, and every resolved path is checked to be inside the
// data directory before anything is removed.
const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;

/** The resolved path, or null if it would escape `DATA`. */
function inside(...parts) {
  const full = resolve(DATA, ...parts);
  const rel = relative(DATA, full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

const manifestPath = join(DATA, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`no manifest at ${manifestPath} — build first`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
let removed = 0;
let bytes = 0;
/** Reject anything that is not a plain dataset id / integer resolution. */
function lodDir(dataset, lod) {
  if (!SAFE_ID.test(String(dataset.id ?? ''))) {
    console.error(`refusing to prune: dataset id ${JSON.stringify(dataset.id)} is not a plain name`);
    process.exit(1);
  }
  if (!Number.isInteger(lod.resolution) || lod.resolution < 0 || lod.resolution > 15) {
    console.error(`refusing to prune: ${dataset.id} has resolution ${JSON.stringify(lod.resolution)}`);
    process.exit(1);
  }
  const dir = inside(dataset.id, `r${lod.resolution}`);
  if (!dir) {
    console.error(`refusing to prune: ${dataset.id}/r${lod.resolution} resolves outside ${DATA}`);
    process.exit(1);
  }
  return dir;
}

for (const dataset of manifest.datasets) {
  for (const lod of dataset.lods) {
    if (!lod.tileIndex) continue;
    const dir = lodDir(dataset, lod);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const p = inside(dataset.id, `r${lod.resolution}`, name);
      if (!p || statSync(p).isDirectory() || name === 'index.json') continue;
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
  const dsDir = inside(dataset.id);
  if (!dsDir || !existsSync(dsDir)) continue;
  // named files only, never a directory sweep
  const strays = [inside(dataset.id, 'dataset.json')];
  for (const lod of dataset.lods) {
    lodDir(dataset, lod);
    strays.push(inside(dataset.id, `r${lod.resolution}`, 'cells.txt'));
  }
  for (const p of strays) {
    if (!p || !existsSync(p) || statSync(p).isDirectory()) continue;
    bytes += statSync(p).size;
    rmSync(p);
    removed += 1;
  }
}

console.log(`pruned ${removed} files the site never fetches (${(bytes / 1e6).toFixed(0)} MB) from ${DATA}`);
