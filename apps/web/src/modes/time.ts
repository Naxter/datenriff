// Timeline arithmetic shared by the slider and the morph: `t` in [0, 1]
// sweeps a series of n steps; the sculpture mixes the two neighbours.

export interface TimeSegment {
  /** Index of the lower step. */
  i: number;
  /** Position between step i and i + 1, in [0, 1]. */
  local: number;
}

export function timeSegment(t: number, stepCount: number): TimeSegment {
  const n = Math.max(2, stepCount);
  const pos = Math.min(1, Math.max(0, t)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(pos));
  return { i, local: pos - i };
}

/** Step nearest to `t`. */
export function nearestStep(t: number, stepCount: number): number {
  const n = Math.max(2, stepCount);
  return Math.round(Math.min(1, Math.max(0, t)) * (n - 1));
}

/** Slider position of a step. */
export function stepT(index: number, stepCount: number): number {
  const n = Math.max(2, stepCount);
  return index / (n - 1);
}

/** Sweep duration: ~1.3 s per step, kept within sensible bounds. */
export function sweepDuration(stepCount: number): number {
  return Math.min(24_000, Math.max(2600, 1300 * (Math.max(2, stepCount) - 1)));
}
