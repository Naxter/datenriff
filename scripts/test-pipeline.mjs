#!/usr/bin/env node
// Runs the zensus pipeline unit tests with the first Python that works:
// the pipeline venv if present, otherwise python3 / python / py -3.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIPELINE = join(ROOT, 'pipelines', 'zensus');
const win = process.platform === 'win32';

const venvPython = win
  ? join(PIPELINE, '.venv', 'Scripts', 'python.exe')
  : join(PIPELINE, '.venv', 'bin', 'python');

const candidates = [
  ...(existsSync(venvPython) ? [[venvPython, []]] : []),
  ['python3', []],
  ['python', []],
  ['py', ['-3']],
];

const args = ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.', '-v'];

for (const [cmd, pre] of candidates) {
  const probe = spawnSync(cmd, [...pre, '--version'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) continue;
  const run = spawnSync(cmd, [...pre, ...args], { cwd: PIPELINE, stdio: 'inherit' });
  process.exit(run.status ?? 1);
}

console.error('No Python interpreter found (tried venv, python3, python, py -3).');
process.exit(1);
