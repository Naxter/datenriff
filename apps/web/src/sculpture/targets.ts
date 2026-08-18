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
import { metricDefinition } from '../data/loader';
import { CHANGE_PCT_METRIC } from '../modes/modes';

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

export interface ModeTarget extends MorphTarget {
  colorStats: MetricStats;
  /** Elevation buffers per time step (same calibration), for scrubbing. */
  timeHeights?: Map<string, Float32Array>;
}

export class TargetBuilder {
  private readonly cache = new Map<string, ModeTarget>();
  private readonly derived = new Map<string, { values: Float32Array; stats: MetricStats }>();

  constructor(private readonly scene: SceneData) {}

  /** Raw values + stats for a metric id, including derived metrics. */
  resolveMetric(id: string): { values: Float32Array | Uint8Array; stats: MetricStats } {
    if (id === CHANGE_PCT_METRIC) return this.changePct();
    const values = this.scene.metrics.get(id);
    if (!values) throw new Error(`Metric buffer missing: ${id}`);
    const stats = metricDefinition(this.scene.dataset, id).stats;
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
    const radiusDeg = ((this.scene.lod.cellRadiusMeters || 500) * 2.2) / 111_320;
    return computeOcclusion(
      this.scene.positions,
      heights,
      radiusDeg,
      TARGET_MAX_HEIGHT_METERS * 0.04,
    );
  }

  build(mode: SculptureMode, palette: string | null = null): ModeTarget {
    const colorScale = effectiveColorScale(mode, palette);
    const key = `${mode.id}|${colorScale.palette}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const height = this.resolveMetric(mode.heightMetric);
    const scale = elevationScaleFor(
      height.stats,
      TARGET_MAX_HEIGHT_METERS,
      mode.heightScale.calibrationQuantile ?? 0.995,
      PEAKEDNESS,
    );
    const heights = computeElevations(toF32(height.values), scale);

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
      for (const step of mode.time.steps) {
        const metricId = mode.time.metricTemplate.replace('{step}', step);
        const stepValues = this.resolveMetric(metricId).values;
        target.timeHeights.set(step, computeElevations(toF32(stepValues), scale));
      }
    }

    this.cache.set(key, target);
    return target;
  }
}

function toF32(values: Float32Array | Uint8Array): Float32Array {
  return values instanceof Float32Array ? values : Float32Array.from(values);
}
