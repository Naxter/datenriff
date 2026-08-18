// Metric buffers are shipped as scalars and mapped to colours in the
// browser, so scales stay adjustable at runtime. All mappers write into a
// caller-owned Uint8Array (n × 4 RGBA, alpha 255) to avoid per-frame
// allocations.

import type {
  MetricStats,
  SequentialScaleDefinition,
  DivergingScaleDefinition,
  CategoricalScaleDefinition,
  ColorScaleDefinition,
} from '@datenriff/data-contracts';
import {
  MISSING,
  getPalette,
  type Palette,
  type RGB,
  type CategoricalPalette,
} from './palettes.js';

export type MetricValues = Float32Array | Uint8Array;

/** Piecewise-linear interpolation over palette stops, t clamped to [0,1]. */
export function interpolateStops(stops: RGB[], t: number): RGB {
  const n = stops.length;
  if (n === 1) return stops[0]!;
  const tc = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const x = tc * (n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const f = x - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function transform(type: SequentialScaleDefinition['type'], v: number): number {
  switch (type) {
    case 'linear':
      return v;
    case 'sqrt':
      return Math.sqrt(Math.max(0, v));
    case 'log1p':
      return Math.log1p(Math.max(0, v));
  }
}

/** Domain of a sequential scale: quantities start at 0, upper end clipped
 * at a robust quantile rather than the absolute max. */
export function resolveSequentialDomain(
  def: SequentialScaleDefinition,
  stats: MetricStats,
): [number, number] {
  if (def.domain) return def.domain;
  let hi = stats.max;
  if (def.clip !== undefined) {
    // stats carry a fixed quantile set; snap to the closest
    hi = def.clip <= 0.5 ? stats.p50 : def.clip <= 0.95 ? stats.p95 : stats.p995;
  }
  const lo = stats.min >= 0 ? 0 : stats.min;
  if (hi <= lo) hi = lo + 1;
  return [lo, hi];
}

export function mapSequential(
  values: MetricValues,
  def: SequentialScaleDefinition,
  stats: MetricStats,
  out: Uint8Array,
): void {
  const [lo, hi] = resolveSequentialDomain(def, stats);
  const tLo = transform(def.type, Math.max(0, lo));
  const tHi = transform(def.type, hi);
  const span = tHi - tLo || 1;
  const palette = getPalette(def.palette);
  if (palette.kind === 'categorical') {
    throw new Error(`Palette "${def.palette}" is categorical, not sequential`);
  }
  const stops = palette.stops;
  const gamma = def.gamma ?? 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const o = i * 4;
    out[o + 3] = 255;
    if (Number.isNaN(v)) {
      out[o] = MISSING[0];
      out[o + 1] = MISSING[1];
      out[o + 2] = MISSING[2];
      continue;
    }
    let t = (transform(def.type, v) - tLo) / span;
    if (gamma !== 1) t = Math.pow(t < 0 ? 0 : t > 1 ? 1 : t, gamma);
    const [r, g, b] = interpolateStops(stops, t);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}

export function resolveDivergingHalfWidth(
  def: DivergingScaleDefinition,
  stats: MetricStats,
): number {
  if (def.halfWidth !== undefined) return def.halfWidth;
  const hw = Math.max(
    Math.abs(stats.min - def.center),
    Math.abs(stats.max - def.center),
  );
  return hw || 1;
}

export function mapDiverging(
  values: MetricValues,
  def: DivergingScaleDefinition,
  stats: MetricStats,
  out: Uint8Array,
): void {
  const palette = getPalette(def.palette);
  if (palette.kind === 'categorical') {
    throw new Error(`Palette "${def.palette}" is categorical, not diverging`);
  }
  const stops = palette.stops;
  const hw = resolveDivergingHalfWidth(def, stats);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const o = i * 4;
    out[o + 3] = 255;
    if (Number.isNaN(v)) {
      out[o] = MISSING[0];
      out[o + 1] = MISSING[1];
      out[o + 2] = MISSING[2];
      continue;
    }
    // 0 = strongest negative, 0.5 = centre, 1 = strongest positive
    const t = 0.5 + (v - def.center) / (2 * hw);
    const [r, g, b] = interpolateStops(stops, t);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}

/** Categorical mapping; low dominance blends towards the neutral so mixed
 * cells read as mixed. `saturation` is u8, 255 ≙ 100 %. */
export function mapCategorical(
  categories: MetricValues,
  def: CategoricalScaleDefinition,
  out: Uint8Array,
  saturation?: Uint8Array,
): void {
  const palette = getPalette(def.palette) as CategoricalPalette;
  if (palette.kind !== 'categorical') {
    throw new Error(`Palette "${def.palette}" is not categorical`);
  }
  const { colors, neutral } = palette;
  const DOM_LO = 0.33;
  const DOM_HI = 0.9;
  for (let i = 0; i < categories.length; i++) {
    const c = categories[i]!;
    const o = i * 4;
    out[o + 3] = 255;
    const rgb = colors[c] ?? MISSING;
    let s = 1;
    if (saturation) {
      const d = saturation[i]! / 255;
      s = (d - DOM_LO) / (DOM_HI - DOM_LO);
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      // keep a floor so the dominant hue stays identifiable
      s = 0.25 + 0.75 * s;
    }
    out[o] = Math.round(neutral[0] + (rgb[0] - neutral[0]) * s);
    out[o + 1] = Math.round(neutral[1] + (rgb[1] - neutral[1]) * s);
    out[o + 2] = Math.round(neutral[2] + (rgb[2] - neutral[2]) * s);
  }
}

export function applyColorScale(
  def: ColorScaleDefinition,
  values: MetricValues,
  stats: MetricStats,
  out: Uint8Array,
  saturation?: Uint8Array,
): void {
  if (out.length < values.length * 4) {
    throw new Error('Colour output buffer too small');
  }
  switch (def.type) {
    case 'linear':
    case 'sqrt':
    case 'log1p':
      mapSequential(values, def, stats, out);
      break;
    case 'diverging':
      mapDiverging(values, def, stats, out);
      break;
    case 'categorical':
      mapCategorical(values, def, out, saturation);
      break;
  }
}

/** Sample a palette into CSS colours for legend rendering. */
export function legendGradient(paletteId: string, samples = 24): string[] {
  const palette: Palette = getPalette(paletteId);
  if (palette.kind === 'categorical') {
    return palette.colors.map(([r, g, b]) => `rgb(${r},${g},${b})`);
  }
  const result: string[] = [];
  for (let i = 0; i < samples; i++) {
    const [r, g, b] = interpolateStops(palette.stops, i / (samples - 1));
    result.push(`rgb(${r},${g},${b})`);
  }
  return result;
}
