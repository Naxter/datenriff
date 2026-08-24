#!/usr/bin/env node
// Puts the licence documents into the built site.
//
// The deployed site is a distribution of this work, so it has to carry what
// the licences say a distribution carries: Apache-2.0 §4(a) the licence
// itself, §4(d) the NOTICE, and the bundled dependencies' notices, which a
// minified bundle keeps none of. They lived only in the repository, which
// nobody visiting the site can see.
//
// Runs as part of `npm run build`, after Vite has emptied and filled dist.
//
// Usage: node scripts/copy-legal.mjs [dist dir]

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.argv[2] ?? join(ROOT, 'apps', 'web', 'dist');

// Served under /legal/ rather than the root: `/LICENSE` beside `/index.html`
// reads like a stray file, and a directory says these belong together.
const FILES = ['LICENSE', 'NOTICE', 'AUTHORS', 'THIRD-PARTY-NOTICES.md'];

if (!existsSync(DIST)) {
  console.error(`no build at ${DIST} — run the build first`);
  process.exit(1);
}

const out = join(DIST, 'legal');
mkdirSync(out, { recursive: true });

let copied = 0;
const missing = [];
for (const name of FILES) {
  const from = join(ROOT, name);
  if (!existsSync(from)) {
    missing.push(name);
    continue;
  }
  copyFileSync(from, join(out, name));
  copied += 1;
}

if (missing.length) {
  // Not a warning to skim past: shipping without these breaks the terms the
  // project is distributed under.
  console.error(`missing licence document(s): ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`copied ${copied} licence document(s) into ${out}`);
