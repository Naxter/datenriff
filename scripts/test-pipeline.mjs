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
const BLACK_MARBLE = join(ROOT, 'pipelines', 'black-marble');
const MASTR = join(ROOT, 'pipelines', 'mastr');
const DWD = join(ROOT, 'pipelines', 'dwd');

for (const [cmd, pre] of candidates) {
  const probe = spawnSync(cmd, [...pre, '--version'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) continue;
  const census = spawnSync(cmd, [...pre, ...args], { cwd: PIPELINE, stdio: 'inherit' });
  if (census.status !== 0) process.exit(census.status ?? 1);
  // black-marble reuses the census binary writer; its own tests are stdlib-only
  const sep = win ? ';' : ':';
  const nightLights = spawnSync(cmd, [...pre, ...args], {
    cwd: BLACK_MARBLE,
    stdio: 'inherit',
    env: { ...process.env, PYTHONPATH: `.${sep}${PIPELINE}` },
  });
  if (nightLights.status !== 0) process.exit(nightLights.status ?? 1);
  // mastr likewise; stdlib + h3 only
  const mastr = spawnSync(cmd, [...pre, ...args], {
    cwd: MASTR,
    stdio: 'inherit',
    env: { ...process.env, PYTHONPATH: `.${sep}${PIPELINE}` },
  });
  if (mastr.status !== 0) process.exit(mastr.status ?? 1);
  // dwd: the reprojection tests skip themselves without pyproj
  const dwd = spawnSync(cmd, [...pre, ...args], {
    cwd: DWD,
    stdio: 'inherit',
    env: { ...process.env, PYTHONPATH: `.${sep}${PIPELINE}` },
  });
  process.exit(dwd.status ?? 1);
}

console.error('No Python interpreter found (tried venv, python3, python, py -3).');
process.exit(1);
