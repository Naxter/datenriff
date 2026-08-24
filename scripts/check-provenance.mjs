#!/usr/bin/env node
// Can every map on this site be traced back to the file it came from?
//
// Provenance travels in the manifest and is rendered nowhere, so a dataset
// that lost its source hash looks exactly like one that kept it. Four of the
// six pipelines used to write `"sourceHash": null` outright. This reports
// what each dataset can and cannot account for, and fails when a field that
// should always be there is not.
//
//   node scripts/check-provenance.mjs [data dir]
//
// A gap is fixed by re-running that pipeline, not by editing the manifest:
// the point of the record is that a machine wrote it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.argv[2] ?? join(ROOT, 'apps', 'web', 'public', 'data');

// Always available, whatever the source: these say who made the file, when,
// and from which revision of this repository.
const REQUIRED = ['sourceUrl', 'pipelineVersion', 'gitCommit', 'generatedAt'];
// Wanted, and now obtainable for every pipeline — but a dataset built before
// `zensus_pipeline/provenance.py` existed will be missing them until it is
// re-run, which is a reason to report rather than to fail.
const WANTED = ['sourceHash', 'downloadDate'];

const manifestPath = join(DATA, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`no manifest at ${manifestPath} — run the pipelines, then npm run build:manifest`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let failed = 0;
let incomplete = 0;

for (const dataset of manifest.datasets) {
  const p = dataset.source?.provenance ?? {};
  const missingRequired = REQUIRED.filter((k) => !p[k]);
  const missingWanted = WANTED.filter((k) => !p[k]);
  const status = missingRequired.length ? 'FAIL' : missingWanted.length ? 'thin' : 'ok';
  if (missingRequired.length) failed += 1;
  else if (missingWanted.length) incomplete += 1;

  const hash = p.sourceHash ? `${p.sourceHash.slice(0, 17)}…` : '—';
  const files = p.sourceFiles ? `${p.sourceFiles} file(s)` : '';
  console.log(
    `${status.padEnd(5)} ${dataset.id.padEnd(10)} ${(p.pipelineVersion ?? '?').padEnd(26)}` +
      ` ${(p.gitCommit ?? '?').padEnd(8)} ${(p.downloadDate ?? '?').padEnd(11)} ${hash} ${files}`,
  );
  const gaps = [...missingRequired, ...missingWanted];
  if (gaps.length) console.log(`${' '.repeat(6)}missing: ${gaps.join(', ')}`);
}

console.log('');
if (failed) {
  console.error(`${failed} dataset(s) cannot say where they came from. Re-run those pipelines.`);
  process.exit(1);
}
if (incomplete) {
  console.log(
    `${incomplete} dataset(s) are thin: they predate zensus_pipeline/provenance.py and will fill in\n` +
      'on the next pipeline run. Nothing to fix by hand.',
  );
}
console.log(`${manifest.datasets.length} dataset(s) checked.`);
