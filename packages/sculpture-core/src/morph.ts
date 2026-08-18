// Mode switches and timeline scrubs never swap the sculpture hard: heights
// and colours interpolate over ~1s. The engine owns one pair of live
// buffers that the render layer reads every frame; transitions mutate them
// in place, so nothing is allocated per frame. CPU interpolation is fine
// at country-LOD counts; a shader-based mix can replace the internals
// later without changing this API.

export type Easing = (t: number) => number;

export const cubicInOut: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const linearEase: Easing = (t) => t;

export interface MorphTarget {
  /** Per-cell elevations in metres, already calibrated. */
  heights: Float32Array;
  /** Per-cell RGBA, length = 4 × count. */
  colors: Uint8Array;
}

export class MorphEngine {
  readonly count: number;
  readonly heights: Float32Array;
  readonly colors: Uint8Array;

  private readonly fromHeights: Float32Array;
  private readonly fromColors: Float32Array;
  private target: MorphTarget | null = null;
  private startTime = 0;
  private duration = 900;
  private easing: Easing = cubicInOut;
  private animating = false;

  constructor(count: number) {
    this.count = count;
    this.heights = new Float32Array(count);
    this.colors = new Uint8Array(count * 4);
    this.fromHeights = new Float32Array(count);
    // colour interpolation runs in float space to avoid rounding drift
    this.fromColors = new Float32Array(count * 4);
  }

  get isAnimating(): boolean {
    return this.animating;
  }

  start(target: MorphTarget, nowMs: number, duration = 900, easing: Easing = cubicInOut): void {
    this.assertTarget(target);
    this.fromHeights.set(this.heights);
    this.fromColors.set(this.colors);
    this.target = target;
    this.startTime = nowMs;
    this.duration = Math.max(1, duration);
    this.easing = easing;
    this.animating = true;
  }

  /** Jump without animation (initial load, prefers-reduced-motion). */
  snapTo(target: MorphTarget): void {
    this.assertTarget(target);
    this.heights.set(target.heights);
    this.colors.set(target.colors);
    this.target = null;
    this.animating = false;
  }

  /** Advance the transition; true while buffers still change. */
  tick(nowMs: number): boolean {
    if (!this.animating || !this.target) return false;
    const raw = (nowMs - this.startTime) / this.duration;
    if (raw >= 1) {
      this.snapTo(this.target);
      return true; // final frame still needs an upload
    }
    const t = this.easing(raw < 0 ? 0 : raw);
    const { heights: th, colors: tc } = this.target;
    const fh = this.fromHeights;
    const fc = this.fromColors;
    const h = this.heights;
    const c = this.colors;
    for (let i = 0; i < h.length; i++) {
      h[i] = fh[i]! + (th[i]! - fh[i]!) * t;
    }
    for (let i = 0; i < c.length; i++) {
      c[i] = fc[i]! + (tc[i]! - fc[i]!) * t;
    }
    return true;
  }

  /** Timeline scrub: heights = mix(a, b, t), applied immediately.
   * Cancels a running transition; colours stay untouched. */
  setHeightMix(a: Float32Array, b: Float32Array, t: number): void {
    if (a.length !== this.count || b.length !== this.count) {
      throw new Error('Mix buffers differ in length from engine');
    }
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    const h = this.heights;
    for (let i = 0; i < h.length; i++) {
      h[i] = a[i]! + (b[i]! - a[i]!) * tc;
    }
    this.target = null;
    this.animating = false;
  }

  private assertTarget(target: MorphTarget): void {
    if (target.heights.length !== this.count || target.colors.length !== this.count * 4) {
      throw new Error(
        `Morph target size mismatch: expected ${this.count} cells, ` +
          `got heights=${target.heights.length}, colors=${target.colors.length / 4}`,
      );
    }
  }
}
