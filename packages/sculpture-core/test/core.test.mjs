import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MorphEngine,
  applyOcclusion,
  buildChangePct,
  computeElevations,
  computeOcclusion,
  computeStats,
  elevationScaleFor,
  hexColumnRadius,
} from '../dist/index.js';

test('hexColumnRadius applies overlap to the H3 edge length', () => {
  assert.ok(Math.abs(hexColumnRadius(8) - 461.4 * 1.15) < 1e-6);
  assert.throws(() => hexColumnRadius(99));
});

test('elevationScaleFor calibrates against p995, not max', () => {
  const stats = { min: 0, max: 10000, p50: 10, p95: 100, p995: 1000 };
  assert.equal(elevationScaleFor(stats, 55000, 0.995), 55);
});

test('computeElevations zeroes NaN and negatives', () => {
  const out = computeElevations(new Float32Array([NaN, -5, 10]), 2);
  assert.deepEqual([...out], [0, 0, 20]);
});

test('buildChangePct suppresses small denominators', () => {
  const pct = buildChangePct(
    new Float32Array([110, 10, 50]),
    new Float32Array([100, 5, NaN]),
    25,
  );
  assert.ok(Math.abs(pct[0] - 0.1) < 1e-6);
  assert.ok(Number.isNaN(pct[1]), 'denominator below minimum → NaN');
  assert.ok(Number.isNaN(pct[2]), 'missing 2011 value → NaN');
});

test('computeStats ignores NaN and sorts quantiles', () => {
  const values = new Float32Array(1000);
  for (let i = 0; i < 1000; i++) values[i] = i;
  values[0] = NaN;
  const s = computeStats(values);
  assert.equal(s.min, 1);
  assert.equal(s.max, 999);
  assert.ok(s.p95 >= 940 && s.p95 <= 960);
});

test('MorphEngine interpolates and converges to the target', () => {
  const engine = new MorphEngine(2);
  engine.snapTo({ heights: new Float32Array([0, 100]), colors: new Uint8Array([0, 0, 0, 255, 200, 200, 200, 255]) });
  const target = { heights: new Float32Array([100, 0]), colors: new Uint8Array([100, 100, 100, 255, 0, 0, 0, 255]) };

  engine.start(target, 1000, 100);
  assert.ok(engine.isAnimating);

  engine.tick(1050); // halfway (eased)
  assert.ok(engine.heights[0] > 0 && engine.heights[0] < 100);
  assert.ok(engine.heights[1] > 0 && engine.heights[1] < 100);

  const busy = engine.tick(1200); // past the end
  assert.ok(busy, 'final frame still reports a change');
  assert.ok(!engine.isAnimating);
  assert.deepEqual([...engine.heights], [100, 0]);
  assert.deepEqual([...engine.colors], [100, 100, 100, 255, 0, 0, 0, 255]);

  assert.ok(!engine.tick(1300), 'idle engine reports no change');
});

test('MorphEngine.setHeightMix scrubs between two buffers', () => {
  const engine = new MorphEngine(2);
  const a = new Float32Array([0, 100]);
  const b = new Float32Array([100, 300]);
  engine.setHeightMix(a, b, 0.5);
  assert.deepEqual([...engine.heights], [50, 200]);
  engine.setHeightMix(a, b, 2); // clamped
  assert.deepEqual([...engine.heights], [100, 300]);
});

test('MorphEngine rejects mismatched targets', () => {
  const engine = new MorphEngine(2);
  assert.throws(() =>
    engine.snapTo({ heights: new Float32Array(3), colors: new Uint8Array(12) }),
  );
});

test('elevationScaleFor: peakedness moves the anchor from quantile to max', () => {
  const stats = { min: 0, max: 20000, p50: 50, p95: 1000, p995: 5000 };
  const atQuantile = elevationScaleFor(stats, 100_000, 0.995, 0);
  const atMax = elevationScaleFor(stats, 100_000, 0.995, 1);
  assert.equal(atQuantile, 100_000 / 5000, 'peakedness 0 keeps the p995 anchor');
  assert.equal(atMax, 100_000 / 20000, 'peakedness 1 anchors at the maximum');
  const mid = elevationScaleFor(stats, 100_000, 0.995, 0.5);
  assert.ok(mid < atQuantile && mid > atMax, 'blend sits between the two');
  // geometric midpoint: sqrt(5000 * 20000) = 10000
  assert.ok(Math.abs(100_000 / mid - 10000) < 1e-6);
});

test('computeOcclusion: a low cell among tall neighbours is shaded', () => {
  // three cells in a row, 0.01° apart; the middle one is short
  const positions = new Float32Array([0, 0, 0.01, 0, 0.02, 0]);
  const heights = new Float32Array([1000, 0, 1000]);
  const occ = computeOcclusion(positions, heights, 0.011, 1000);
  assert.ok(occ[1] > 0.9, 'shaded cell is nearly fully occluded');
  assert.ok(occ[0] < 0.6, 'tall cells stay comparatively open');
});

test('computeOcclusion: a flat field is unoccluded', () => {
  const positions = new Float32Array([0, 0, 0.01, 0, 0.02, 0]);
  const heights = new Float32Array([500, 500, 500]);
  const occ = computeOcclusion(positions, heights, 0.011, 1000);
  assert.deepEqual([...occ], [0, 0, 0]);
});

test('applyOcclusion darkens proportionally and leaves alpha alone', () => {
  const colors = new Uint8Array([200, 100, 50, 255]);
  applyOcclusion(colors, new Float32Array([1]), 0.5);
  assert.deepEqual([...colors], [100, 50, 25, 255]);
});
