#!/usr/bin/env node
// Looks at the thing that is about to be uploaded, and refuses if it is
// wrong. Runs after the build and the prune, before wrangler.
//
// The deploy used to go straight from `vite build` to `wrangler pages
// deploy`: nothing checked that the prune had run, that the artifact fit the
// platform's limits, or that the legal documents and the manifest were in it.
// A failure there is a broken public site, found by a visitor.
//
// Usage: node scripts/validate-dist.mjs [dist dir]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.argv[2] ?? join(ROOT, 'apps', 'web', 'dist');

// Cloudflare Pages / Workers static assets, free plan.
// https://developers.cloudflare.com/pages/platform/limits/
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const MUST_EXIST = [
  'index.html',
  '404.html',
  '_headers',
  'robots.txt',
  'sitemap.xml',
  'data/manifest.json',
  'impressum/index.html',
  'datenschutz/index.html',
  'legal/LICENSE',
  'legal/NOTICE',
  'legal/THIRD-PARTY-NOTICES.md',
];

const problems = [];
const note = (m) => problems.push(m);

if (!existsSync(DIST)) {
  console.error(`no build at ${DIST} — run npm run build`);
  process.exit(1);
}

for (const rel of MUST_EXIST) {
  if (!existsSync(join(DIST, rel))) note(`missing from the build: ${rel}`);
}

let files = 0;
let bytes = 0;
let largest = { rel: '', size: 0 };
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const size = statSync(full).size;
    files += 1;
    bytes += size;
    if (size > largest.size) largest = { rel: relative(DIST, full), size };
    if (size > MAX_FILE_BYTES) {
      note(`${relative(DIST, full)} is ${(size / 1048576).toFixed(1)} MiB, over the 25 MiB limit`);
    }
  }
};
walk(DIST);

if (files > MAX_FILES) note(`${files.toLocaleString('en-GB')} files, over the ${MAX_FILES} limit`);

// The prune is load-bearing, not an optimisation: unpruned, r10's cells.txt
// alone is past the per-file limit. Its absence is the usual cause.
if (existsSync(join(DIST, 'data', 'zensus', 'r10', 'cells.txt'))) {
  note('data/zensus/r10/cells.txt is still here — the prune did not run');
}

// Every data URL should carry its level's version stamp, or the immutable
// cache rule in _headers is a promise the URLs cannot keep.
if (existsSync(join(DIST, 'data', 'manifest.json'))) {
  const manifest = JSON.parse(readFileSync(join(DIST, 'data', 'manifest.json'), 'utf8'));
  const unstamped = [];
  for (const dataset of manifest.datasets ?? []) {
    for (const lod of dataset.lods ?? []) {
      for (const key of ['positions', 'metricTemplate', 'tileIndex', 'tilePackTemplate']) {
        if (lod[key] && !/\?v=[0-9a-f]+$/.test(lod[key])) {
          unstamped.push(`${dataset.id}/r${lod.resolution}.${key}`);
        }
      }
    }
  }
  if (unstamped.length) {
    note(`data URLs without a version stamp: ${unstamped.slice(0, 4).join(', ')}` +
      `${unstamped.length > 4 ? ` (+${unstamped.length - 4} more)` : ''}` +
      ' — run npm run build:manifest');
  }
}

console.log(
  `${files.toLocaleString('en-GB')} files, ${(bytes / 1e6).toFixed(0)} MB, ` +
    `largest ${(largest.size / 1048576).toFixed(1)} MiB (${largest.rel})`,
);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem(s) — not deploying.`);
  process.exit(1);
}
console.log('artifact looks deployable.');
