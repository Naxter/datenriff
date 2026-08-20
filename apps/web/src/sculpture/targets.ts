// Turns loaded scalar buffers into morph targets (calibrated elevations +
// mapped colours), cached per mode and palette.

import type {
  ColorScaleDefinition,
  MetricStats,
  SculptureMode,
} from '@datenriff/data-contracts';
import { PALETTES, applyColorScale } from '@datenriff/color-scales';
import {
  applyOcclusion,
  buildChangePct,
  computeElevations,
  computeOcclusion,
  computeStats,
  elevationScaleFor,
  type MorphTarget,
} from '@datenriff/sculpture-core';
import type { SceneData } from '../data/loader';
import { metricForScene } from '../data/loader';
import { CHANGE_PCT_METRIC } from '../modes/modes';
import { applyFocus, focusKey, focusMask, type FocusGeometry } from './focus';

/** Composition height of the p99.5 peak, tuned against the prototype. */
export const TARGET_MAX_HEIGHT_METERS = 100_000;

/** Height anchor between the p99.5 quantile (0) and the maximum (1). Higher
 *  values flatten the plain and leave isolated spires — the editorial look.
 *  Keep in sync with the prototype's `?peak=`. */
export const PEAKEDNESS = 0.55;

/** Tip width as a fraction of the column base. Prototype: `?taper=`. */
export const COLUMN_TAPER = 0.35;

/** Ambient occlusion strength. Prototype: `?ao=`. */
// Off: real cast shadows on the ground plane do this job; baked occlusion
// only greyed the low cells. Kept as a knob for datasets without shadows.
export const OCCLUSION_STRENGTH = 0;

/** Stands in for the occlusion field while the strength is zero. */
const EMPTY_OCCLUSION = new Float32Array(0);

/** Apply a user ramp override; only sequential scales are overridable. */
export function effectiveColorScale(
  mode: SculptureMode,
  palette: string | null,
): ColorScaleDefinition {
  const scale = mode.colorScale;
  if (!palette || palette === scale.palette) return scale;
  const isSequential =
    scale.type === 'linear' || scale.type === 'sqrt' || scale.type === 'log1p';
  if (!isSequential || PALETTES[palette]?.kind !== 'sequential') return scale;
  return { ...scale, palette };
}

/** The country calibration for a mode: the scale every level is derived
 *  from (see `fineElevationScale`), and what the country LOD itself uses. */
export function modeElevationScale(mode: SculptureMode, stats: MetricStats): number {
  return elevationScaleFor(
    stats,
    mode.heightScale.maxMeters ?? TARGET_MAX_HEIGHT_METERS,
    mode.heightScale.calibrationQuantile ?? 0.995,
    PEAKEDNESS,
    mode.heightScale.zeroAt ?? 0,
  );
}

/** Does height stand for a count? A count belongs to the area it was counted
 *  in, so the fine levels redraw it per unit area; a mean, a share or a rate
 *  is already per-area and carries over as it is.
 *
 *  `null` when this scene's dataset does not carry the metric at all: while a
 *  new dataset streams, the chosen mode is already the new one and the
 *  sculpture on screen is still the old one, so the pair does not have to
 *  match. Asking the definition directly rather than through
 *  `metricForScene`, which throws on an unknown metric. */
export function heightIsCount(scene: SceneData, mode: SculptureMode): boolean | null {
  const def = scene.dataset.metrics.find((m) => m.id === mode.heightMetric);
  return def ? def.aggregation === 'sum' : null;
}

export interface ModeTarget extends MorphTarget {
  colorStats: MetricStats;
  /** Elevation buffers per time step (same calibration), for scrubbing. */
  timeHeights?: Map<string, Float32Array>;
  /** Colour buffers per time step, when colour shows the same quantity as
   *  height (a brightness year, a capacity year); absent when colour is a
   *  derived property such as the 2011→2022 change. */
  timeColors?: Map<string, Uint8Array>;
}

export class TargetBuilder {
  /** Built targets, newest last. Each holds heights and colours for every
   *  cell — megabytes at the fine LODs — so the map is capped and the
   *  least recently used entry is dropped rather than kept for a mode the
   *  viewer may never return to. */
  private readonly cache = new Map<string, ModeTarget>();
  private static readonly CACHE_LIMIT = 6;
  /** The dataset this builder serves; modes are bound to it. */
  get dataset() {
    return this.scene.dataset;
  }
  private readonly derived = new Map<string, { values: Float32Array; stats: MetricStats }>();

  constructor(private readonly scene: SceneData) {}

  /** Raw values + stats for a metric id, including derived metrics. */
  resolveMetric(id: string): { values: Float32Array | Uint8Array; stats: MetricStats } {
    if (id === CHANGE_PCT_METRIC) return this.changePct();
    const values = this.scene.metrics.get(id);
    if (!values) throw new Error(`Metric buffer missing: ${id}`);
    const stats = metricForScene(this.scene, id).stats;
    if (!stats) throw new Error(`Metric stats missing: ${id}`);
    return { values, stats };
  }

  private changePct(): { values: Float32Array; stats: MetricStats } {
    let entry = this.derived.get(CHANGE_PCT_METRIC);
    if (!entry) {
      const pop2022 = this.scene.metrics.get('population_2022') as Float32Array;
      const pop2011 = this.scene.metrics.get('population_2011') as Float32Array;
      const values = buildChangePct(pop2022, pop2011);
      entry = { values, stats: computeStats(values) };
      this.derived.set(CHANGE_PCT_METRIC, entry);
    }
    return entry;
  }

  /** Occlusion depends on the height field, so it is cached per mode. */
  private occlusion(heights: Float32Array): Float32Array {
    // applyOcclusion returns immediately at zero strength — but its argument
    // is evaluated first, so the whole field was computed and thrown away,
    // once per mode build and once per timeline step. The tile worker
    // already skips it; this is the same guard on the main thread.
    if (OCCLUSION_STRENGTH <= 0) return EMPTY_OCCLUSION;
    const radiusDeg = ((this.scene.lod.cellRadiusMeters || 500) * 2.2) / 111_320;
    return computeOcclusion(
      this.scene.positions,
      heights,
      radiusDeg,
      TARGET_MAX_HEIGHT_METERS * 0.04,
    );
  }

  private remember(key: string, target: ModeTarget): ModeTarget {
    this.cache.set(key, target);
    while (this.cache.size > TargetBuilder.CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return target;
  }

  /** Per-cell focus masks, cached per focus. */
  private readonly masks = new Map<string, Uint8Array>();

  /** A mode target with a region in focus: the base target with everything
   *  outside the region stepped back (see focus.ts). Cached like the base. */
  build(mode: SculptureMode, palette: string | null = null, focus: FocusGeometry | null = null): ModeTarget {
    if (!focus) return this.buildBase(mode, palette);
    const fkey = focusKey(focus);
    const key = `${mode.id}|${effectiveColorScale(mode, palette).palette}|${fkey}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    let mask = this.masks.get(fkey);
    if (!mask) {
      mask = focusMask(this.scene.positions, focus);
      this.masks.set(fkey, mask);
    }
    const base = this.buildBase(mode, palette);
    const dim = (h: Float32Array, c: Uint8Array) => {
      const heights = new Float32Array(h);
      const colors = new Uint8Array(c);
      applyFocus(heights, colors, mask!);
      return { heights, colors };
    };
    const main = dim(base.heights, base.colors);
    const target: ModeTarget = { ...base, heights: main.heights, colors: main.colors };
    if (base.timeHeights) {
      target.timeHeights = new Map();
      if (base.timeColors) target.timeColors = new Map();
      for (const [step, h] of base.timeHeights) {
        const c = base.timeColors?.get(step) ?? base.colors;
        const d = dim(h, c);
        target.timeHeights.set(step, d.heights);
        if (base.timeColors) target.timeColors!.set(step, d.colors);
      }
    }
    return this.remember(key, target);
  }

  private buildBase(mode: SculptureMode, palette: string | null = null): ModeTarget {
    const colorScale = effectiveColorScale(mode, palette);
    const key = `${mode.id}|${colorScale.palette}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const height = this.resolveMetric(mode.heightMetric);
    const zeroAt = mode.heightScale.zeroAt ?? 0;
    const scale = modeElevationScale(mode, height.stats);
    const heights = computeElevations(toF32(height.values), scale, undefined, zeroAt);

    const color = this.resolveMetric(mode.colorMetric);
    const colors = new Uint8Array(this.scene.count * 4);
    const saturation =
      colorScale.type === 'categorical' && colorScale.saturationMetric
        ? (this.scene.metrics.get(colorScale.saturationMetric) as Uint8Array)
        : undefined;
    applyColorScale(colorScale, color.values, color.stats, colors, saturation);
    applyOcclusion(colors, this.occlusion(heights), OCCLUSION_STRENGTH);

    const target: ModeTarget = { heights, colors, colorStats: color.stats };

    // same calibration for every step, so a shrinking column really shrank
    if (mode.time) {
      target.timeHeights = new Map();
      // colour follows the step either because it *is* the height metric
      // (night light) or because it declares a series of its own (land cover)
      const colorTemplate =
        mode.time.colorMetricTemplate ??
        (mode.colorMetric === mode.heightMetric ? mode.time.metricTemplate : undefined);
      if (colorTemplate) target.timeColors = new Map();
      for (const step of mode.time.steps) {
        const metricId = mode.time.metricTemplate.replace('{step}', step);
        const stepMetric = this.resolveMetric(metricId);
        target.timeHeights.set(
          step,
          computeElevations(toF32(stepMetric.values), scale, undefined, zeroAt),
        );
        if (colorTemplate) {
          const colorId = colorTemplate.replace('{step}', step);
          const stepColor = colorId === metricId ? stepMetric : this.resolveMetric(colorId);
          const satTemplate = mode.time.saturationMetricTemplate;
          // dominance ships as u8, the same as the un-stepped saturation
          const stepSaturation = satTemplate
            ? (this.scene.metrics.get(satTemplate.replace('{step}', step)) as
                | Uint8Array
                | undefined)
            : saturation;
          // one colour domain (the calibration metric's stats) for every step
          const stepColors = new Uint8Array(this.scene.count * 4);
          applyColorScale(colorScale, stepColor.values, color.stats, stepColors, stepSaturation);
          applyOcclusion(stepColors, this.occlusion(heights), OCCLUSION_STRENGTH);
          target.timeColors!.set(step, stepColors);
        }
      }
    }

    return this.remember(key, target);
  }
}

function toF32(values: Float32Array | Uint8Array): Float32Array {
  return values instanceof Float32Array ? values : Float32Array.from(values);
}
