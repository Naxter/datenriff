import type { MetricStats } from '@datenriff/data-contracts';

/** Pick the precomputed quantile closest to q. */
export function quantileFromStats(stats: MetricStats, q: number): number {
  if (q <= 0.5) return stats.p50;
  if (q <= 0.95) return stats.p95;
  if (q <= 0.995) return stats.p995;
  return stats.max;
}

/** Height stays linear, but each sculpture is calibrated so its p99.5 peak
 * reaches roughly the same composition height. */
export function elevationScaleFor(
  stats: MetricStats,
  targetMaxMeters = 100_000,
  calibrationQuantile = 0.995,
): number {
  const anchor = quantileFromStats(stats, calibrationQuantile);
  if (!(anchor > 0)) return 1;
  return targetMaxMeters / anchor;
}

/** Per-cell elevations in metres. Working in metres (not per-layer scale)
 * keeps cross-mode morphs seamless. NaN → 0. */
export function computeElevations(
  values: Float32Array,
  scale: number,
  out?: Float32Array,
): Float32Array {
  const result = out ?? new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    result[i] = Number.isNaN(v) || v < 0 ? 0 : v * scale;
  }
  return result;
}

/** Relative population change. Percentages against tiny bases are noise,
 * so cells below `minDenominator` yield NaN (rendered as suppressed). */
export function buildChangePct(
  pop2022: Float32Array,
  pop2011: Float32Array,
  minDenominator = 25,
): Float32Array {
  if (pop2022.length !== pop2011.length) {
    throw new Error('Population buffers differ in length');
  }
  const out = new Float32Array(pop2022.length);
  for (let i = 0; i < out.length; i++) {
    const a = pop2011[i]!;
    const b = pop2022[i]!;
    if (Number.isNaN(a) || Number.isNaN(b) || a < minDenominator) {
      out[i] = NaN;
    } else {
      out[i] = (b - a) / a;
    }
  }
  return out;
}

export function buildChangeAbs(
  pop2022: Float32Array,
  pop2011: Float32Array,
): Float32Array {
  const out = new Float32Array(pop2022.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = pop2022[i]! - pop2011[i]!;
  }
  return out;
}

/** Runtime stats for derived buffers; NaNs are ignored. */
export function computeStats(values: Float32Array): MetricStats {
  const finite: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isNaN(v)) {
      finite.push(v);
      sum += v;
    }
  }
  finite.sort((a, b) => a - b);
  const q = (p: number): number =>
    finite.length === 0 ? 0 : finite[Math.min(finite.length - 1, Math.floor(p * finite.length))]!;
  return {
    min: finite.length ? finite[0]! : 0,
    max: finite.length ? finite[finite.length - 1]! : 0,
    p50: q(0.5),
    p95: q(0.95),
    p995: q(0.995),
    sum,
  };
}
