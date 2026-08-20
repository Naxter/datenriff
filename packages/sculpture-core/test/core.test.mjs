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
  fineElevationScale,
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

test('fineElevationScale redraws a count per unit area', () => {
  // r8 (461.4 m) to r10 (65.9 m): forty-nine cells in the place of one
  const fine = fineElevationScale(10.16, 461.4, 65.9, true);
  assert.ok(Math.abs(fine / 10.16 - (461.4 / 65.9) ** 2) < 1e-9);
  // a cell of the same size keeps the country scale
  assert.equal(fineElevationScale(10.16, 461.4, 461.4, true), 10.16);
});

test('fineElevationScale leaves a mean or a share alone', () => {
  assert.equal(fineElevationScale(58.98, 1220.6, 461.4, false), 58.98);
});

test('fineElevationScale falls back when a cell radius is missing', () => {
  assert.equal(fineElevationScale(10.16, 0, 65.9, true), 10.16);
  assert.equal(fineElevationScale(10.16, 461.4, Number.NaN, true), 10.16);
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

test('MorphEngine exposes both endpoints and an eased mix', () => {
  const engine = new MorphEngine(2);
  engine.snapTo({ heights: new Float32Array([0, 0]), colors: new Uint8Array(8) });
  const target = {
    heights: new Float32Array([100, 200]),
    colors: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  };
  engine.start(target, 1000, 1000);
  assert.equal(engine.mixAmount, 0, 'starts at the from state');
  assert.deepEqual([...engine.heightsTo], [100, 200], 'to buffer holds the target');
  assert.deepEqual([...engine.heights], [0, 0], 'from buffer holds the old state');

  engine.tick(1500);
  assert.ok(engine.mixAmount > 0 && engine.mixAmount < 1, 'mid-transition');
  // endpoints stay untouched — only the uniform moves
  assert.deepEqual([...engine.heights], [0, 0]);
  assert.deepEqual([...engine.heightsTo], [100, 200]);

  engine.tick(2000);
  assert.equal(engine.mixAmount, 1);
  assert.ok(!engine.isAnimating, 'transition finished');
  assert.ok(!engine.tick(2100), 'idle engine reports no change');
});

test('MorphEngine.start from mid-transition keeps what is on screen', () => {
  const engine = new MorphEngine(1);
  engine.snapTo({ heights: new Float32Array([0]), colors: new Uint8Array(4) });
  engine.start({ heights: new Float32Array([100]), colors: new Uint8Array(4) }, 0, 1000);
  engine.tick(500); // eased past the midpoint
  const shown = engine.heights[0] + (engine.heightsTo[0] - engine.heights[0]) * engine.mixAmount;
  engine.start({ heights: new Float32Array([300]), colors: new Uint8Array(4) }, 500, 1000);
  assert.ok(
    Math.abs(engine.heights[0] - shown) < 1e-5,
    'the new transition starts from the visible state, not from zero',
  );
});

test('MorphEngine.growFromFlat rises in the target colours, not from black', () => {
  const engine = new MorphEngine(2);
  assert.ok(engine.isPristine);
  const target = {
    heights: new Float32Array([100, 200]),
    colors: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  };
  engine.growFromFlat(target, 0, 1000);
  assert.ok(!engine.isPristine);
  assert.deepEqual([...engine.heights], [0, 0], 'starts flat');
  assert.deepEqual([...engine.colors], [255, 0, 0, 0, 0, 255, 0, 0], 'from = target rgb, alpha 0');
  assert.deepEqual([...engine.heightsTo], [100, 200]);
  assert.deepEqual([...engine.colorsTo], [...target.colors]);
  assert.equal(engine.mixAmount, 0);
  engine.tick(1000);
  assert.equal(engine.mixAmount, 1);
});

test('MorphEngine.fadeOut sinks the visible state into the plane', () => {
  const engine = new MorphEngine(1);
  engine.snapTo({ heights: new Float32Array([100]), colors: new Uint8Array([10, 20, 30, 255]) });
  engine.fadeOut(0, 1000);
  assert.deepEqual([...engine.heights], [100], 'from = what was on screen');
  assert.deepEqual([...engine.colors], [10, 20, 30, 255]);
  assert.deepEqual([...engine.heightsTo], [0], 'to = flat');
  assert.deepEqual([...engine.colorsTo], [10, 20, 30, 0], 'to = same hue, transparent');
  assert.equal(engine.mixAmount, 0);
  assert.ok(engine.isAnimating);
});

test('MorphEngine.scrub parks the step pair and drives the mix', () => {
  const engine = new MorphEngine(2);
  const a = new Float32Array([0, 100]);
  const b = new Float32Array([100, 300]);
  engine.scrub(a, b, 0.5);
  assert.deepEqual([...engine.heights], [0, 100], 'from = step a');
  assert.deepEqual([...engine.heightsTo], [100, 300], 'to = step b');
  assert.equal(engine.mixAmount, 0.5, 'the slider drives the uniform');
  const v = engine.bufferVersion;
  engine.scrub(a, b, 0.8);
  assert.equal(engine.bufferVersion, v, 'same pair: no re-upload');
  assert.equal(engine.mixAmount, 0.8);
  engine.scrub(a, b, 2); // clamped
  assert.equal(engine.mixAmount, 1);
  const c = new Float32Array([5, 5]);
  engine.scrub(b, c, 0.1);
  assert.equal(engine.bufferVersion, v + 1, 'new pair: buffers re-uploaded once');
  assert.deepEqual([...engine.heights], [100, 300]);
  assert.deepEqual([...engine.heightsTo], [5, 5]);
});

test('MorphEngine.scrub with per-step colours mixes colours too', () => {
  const engine = new MorphEngine(1);
  engine.scrub(
    new Float32Array([1]),
    new Float32Array([2]),
    0.25,
    new Uint8Array([10, 0, 0, 255]),
    new Uint8Array([20, 0, 0, 255]),
  );
  assert.deepEqual([...engine.colors], [10, 0, 0, 255]);
  assert.deepEqual([...engine.colorsTo], [20, 0, 0, 255]);
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

test('locateInMerged maps a concatenated index back to its part', async (t) => {
  const { locateInMerged, mergeOffsets } = await import('../dist/index.js');

  await t.test('offsets follow the part lengths', () => {
    const { offsets, total } = mergeOffsets([3, 1, 4]);
    assert.deepEqual([...offsets], [0, 3, 4]);
    assert.equal(total, 8);
  });

  await t.test('every index lands in the part that contains it', () => {
    const lengths = [3, 1, 4, 2];
    const { offsets, total } = mergeOffsets(lengths);
    // walk the whole buffer and rebuild the parts from the answers
    const rebuilt = lengths.map(() => []);
    for (let i = 0; i < total; i++) {
      const at = locateInMerged(offsets, total, i);
      rebuilt[at.part].push(at.local);
    }
    assert.deepEqual(rebuilt, [[0, 1, 2], [0], [0, 1, 2, 3], [0, 1]]);
  });

  await t.test('the boundaries are the easy place to be off by one', () => {
    const { offsets, total } = mergeOffsets([3, 1, 4]);
    assert.deepEqual(locateInMerged(offsets, total, 2), { part: 0, local: 2 });
    assert.deepEqual(locateInMerged(offsets, total, 3), { part: 1, local: 0 });
    assert.deepEqual(locateInMerged(offsets, total, 4), { part: 2, local: 0 });
    assert.deepEqual(locateInMerged(offsets, total, 7), { part: 2, local: 3 });
  });

  await t.test('an index outside the buffer has no part', () => {
    const { offsets, total } = mergeOffsets([2, 2]);
    assert.equal(locateInMerged(offsets, total, -1), null);
    assert.equal(locateInMerged(offsets, total, 4), null);
    assert.equal(locateInMerged(offsets, total, 1.5), null);
    assert.equal(locateInMerged(new Int32Array(0), 0, 0), null);
  });

  await t.test('a single part is the whole buffer', () => {
    const { offsets, total } = mergeOffsets([5]);
    assert.deepEqual(locateInMerged(offsets, total, 0), { part: 0, local: 0 });
    assert.deepEqual(locateInMerged(offsets, total, 4), { part: 0, local: 4 });
  });
});
