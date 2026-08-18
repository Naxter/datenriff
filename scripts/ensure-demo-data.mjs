#!/usr/bin/env node
// Runs the demo-data generator if apps/web/public/data is missing.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(ROOT, 'apps', 'web', 'public', 'data', 'manifest.json');

if (!existsSync(manifest)) {
  console.log('No data manifest found — generating synthetic demo dataset …');
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'generate-demo-data.mjs')], {
    stdio: 'inherit',
  });
}
