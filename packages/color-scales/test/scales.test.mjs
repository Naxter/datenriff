import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interpolateStops,
  mapSequential,
  mapDiverging,
  mapCategorical,
  applyColorScale,
  resolveSequentialDomain,
  legendGradient,
  getPalette,
  MISSING,
} from '../dist/index.js';

const STATS = { min: 0, max: 4000, p50: 40, p95: 900, p995: 2750 };

test('interpolateStops clamps and interpolates', () => {
  const stops = [
    [0, 0, 0],
    [100, 200, 50],
  ];
  assert.deepEqual(interpolateStops(stops, -1), [0, 0, 0]);
  assert.deepEqual(interpolateStops(stops, 2), [100, 200, 50]);
  assert.deepEqual(interpolateStops(stops, 0.5), [50, 100, 25]);
});

test('resolveSequentialDomain clips at p995 and starts quantities at 0', () => {
  const [lo, hi] = resolveSequentialDomain({ type: 'sqrt', palette: 'population', clip: 0.995 }, STATS);
  assert.equal(lo, 0);
  assert.equal(hi, 2750);
});

test('mapSequential: NaN renders as MISSING, top of domain hits last stop', () => {
  const values = new Float32Array([NaN, 0, 2750, 4000]);
  const out = new Uint8Array(values.length * 4);
  mapSequential(values, { type: 'sqrt', palette: 'population', clip: 0.995 }, STATS, out);
  const rgb = (i) => [...out.slice(i * 4, i * 4 + 3)];
  assert.deepEqual(rgb(0), [...MISSING]);
  const palette = getPalette('population');
  const first = palette.stops[0];
  const last = palette.stops[palette.stops.length - 1];
  assert.deepEqual(rgb(1), [...first]);
  // 2750 = p995 → clipped to the final stop; 4000 above the clip → same colour.
  assert.deepEqual(rgb(2), [...last]);
  assert.deepEqual(rgb(3), [...last]);
  assert.equal(out[3], 255, 'alpha is set');
});

test('mapSequential: gamma keeps low values near the pale end', () => {
  const mid = new Float32Array([700]); // sqrt(700)/sqrt(2750) ≈ 0.5
  const plain = new Uint8Array(4);
  const gammaed = new Uint8Array(4);
  mapSequential(mid, { type: 'sqrt', palette: 'noir', clip: 0.995 }, STATS, plain);
  mapSequential(mid, { type: 'sqrt', palette: 'noir', clip: 0.995, gamma: 1.5 }, STATS, gammaed);
  // noir darkens monotonically, so a paler result means a lower ramp position
  assert.ok(gammaed[0] > plain[0], 'gamma pushes mid values towards the pale end');
});

test('mapDiverging: centre maps to the neutral middle stop', () => {
  const values = new Float32Array([0]);
  const out = new Uint8Array(4);
  mapDiverging(values, { type: 'diverging', palette: 'change', center: 0, halfWidth: 0.4 }, STATS, out);
  const stops = getPalette('change').stops;
  const middle = stops[(stops.length - 1) / 2];
  assert.deepEqual([...out.slice(0, 3)], [...middle]);
});

test('mapCategorical: full dominance gives the pure category colour, low dominance is paler', () => {
  const categories = new Uint8Array([0, 0]);
  const saturation = new Uint8Array([255, Math.round(0.4 * 255)]);
  const out = new Uint8Array(8);
  mapCategorical(categories, { type: 'categorical', palette: 'heating' }, out, saturation);
  const { colors, neutral } = getPalette('heating');
  assert.deepEqual([...out.slice(0, 3)], [...colors[0]]);
  const pale = out.slice(4, 7);
  // The pale cell must sit strictly between neutral and the category colour.
  for (let i = 0; i < 3; i++) {
    const lo = Math.min(neutral[i], colors[0][i]);
    const hi = Math.max(neutral[i], colors[0][i]);
    assert.ok(pale[i] >= lo && pale[i] <= hi, `channel ${i} in range`);
  }
  assert.notDeepEqual([...pale], [...colors[0]]);
});

test('applyColorScale dispatches and validates output size', () => {
  const values = new Float32Array([1, 2, 3]);
  assert.throws(() => applyColorScale({ type: 'sqrt', palette: 'population' }, values, STATS, new Uint8Array(4)));
  const out = new Uint8Array(12);
  applyColorScale({ type: 'sqrt', palette: 'population', clip: 0.995 }, values, STATS, out);
});

test('legendGradient returns css colors for both palette kinds', () => {
  assert.equal(legendGradient('population', 5).length, 5);
  assert.equal(legendGradient('heating').length, getPalette('heating').colors.length);
});
