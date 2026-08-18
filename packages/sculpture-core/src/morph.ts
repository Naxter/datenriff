// Mode switches and timeline scrubs never swap the sculpture hard: heights
// and colours blend over ~1s.
//
// The engine keeps the two endpoint buffers and the eased progress; the
// blend itself happens on the GPU (see sculpture/morphColumnLayer.ts), so a
// transition uploads two static buffers once and then moves a single
// uniform per frame instead of rewriting 1.4 M floats. `mixAmount` is the
// value the shader reads.

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
  /** Start of the blend — the `from` attribute buffers. */
  readonly heights: Float32Array;
  readonly colors: Uint8Array;
  /** End of the blend — the `to` attribute buffers. */
  readonly heightsTo: Float32Array;
  readonly colorsTo: Uint8Array;

  /** Eased progress the shader mixes with; 1 = fully at `to`. */
  mixAmount = 1;

  private startTime = 0;
  private duration = 900;
  private easing: Easing = cubicInOut;
  private animating = false;
  /** Bumped whenever the endpoint buffers change and need re-uploading. */
  private version = 0;

  constructor(count: number) {
    this.count = count;
    this.heights = new Float32Array(count);
    this.colors = new Uint8Array(count * 4);
    this.heightsTo = new Float32Array(count);
    this.colorsTo = new Uint8Array(count * 4);
  }

  get isAnimating(): boolean {
    return this.animating;
  }

  /** True until the first target arrives — the buffers are still all zero. */
  get isPristine(): boolean {
    return this.version === 0;
  }

  /** Changes on every endpoint swap; the view keys its buffers on it. */
  get bufferVersion(): number {
    return this.version;
  }

  start(target: MorphTarget, nowMs: number, duration = 900, easing: Easing = cubicInOut): void {
    this.assertTarget(target);
    // freeze the state currently on screen as the new `from`
    this.captureCurrentAsFrom();
    this.heightsTo.set(target.heights);
    this.colorsTo.set(target.colors);
    this.mixAmount = 0;
    this.startTime = nowMs;
    this.duration = Math.max(1, duration);
    this.easing = easing;
    this.animating = true;
    this.version += 1;
  }

  /** Collapse the running blend into the `from` buffers so a new
   *  transition starts from what the viewer actually sees. */
  private captureCurrentAsFrom(): void {
    const t = this.mixAmount;
    if (t <= 0) return;
    const h = this.heights;
    const ht = this.heightsTo;
    const c = this.colors;
    const ct = this.colorsTo;
    if (t >= 1) {
      h.set(ht);
      c.set(ct);
      return;
    }
    for (let i = 0; i < h.length; i++) h[i] = h[i]! + (ht[i]! - h[i]!) * t;
    for (let i = 0; i < c.length; i++) c[i] = c[i]! + (ct[i]! - c[i]!) * t;
  }

  /** Grow a sculpture out of the plane: `from` is flat and transparent but
   *  already carries the target's colours, so the columns rise in their own
   *  hue instead of brightening up from black. Used for the first load and
   *  when a new dataset arrives. */
  growFromFlat(target: MorphTarget, nowMs: number, duration = 1600, easing: Easing = cubicInOut): void {
    this.assertTarget(target);
    this.heights.fill(0);
    this.colors.set(target.colors);
    for (let i = 3; i < this.colors.length; i += 4) this.colors[i] = 0;
    this.heightsTo.set(target.heights);
    this.colorsTo.set(target.colors);
    this.mixAmount = 0;
    this.startTime = nowMs;
    this.duration = Math.max(1, duration);
    this.easing = easing;
    this.animating = true;
    this.version += 1;
  }

  /** The reverse: sink what is on screen back into the plane and fade it
   *  out, keeping its colours. Used for the sculpture being replaced. */
  fadeOut(nowMs: number, duration = 950, easing: Easing = cubicInOut): void {
    this.captureCurrentAsFrom();
    this.heightsTo.fill(0);
    this.colorsTo.set(this.colors);
    for (let i = 3; i < this.colorsTo.length; i += 4) this.colorsTo[i] = 0;
    this.mixAmount = 0;
    this.startTime = nowMs;
    this.duration = Math.max(1, duration);
    this.easing = easing;
    this.animating = true;
    this.version += 1;
  }

  /** Jump without animation (initial load, prefers-reduced-motion). */
  snapTo(target: MorphTarget): void {
    this.assertTarget(target);
    this.heights.set(target.heights);
    this.colors.set(target.colors);
    this.heightsTo.set(target.heights);
    this.colorsTo.set(target.colors);
    this.mixAmount = 1;
    this.animating = false;
    this.version += 1;
  }

  /** Advance the transition; true while `mixAmount` still changes. */
  tick(nowMs: number): boolean {
    if (!this.animating) return false;
    const raw = (nowMs - this.startTime) / this.duration;
    if (raw >= 1) {
      this.mixAmount = 1;
      this.animating = false;
      return true; // one last frame at the end state
    }
    this.mixAmount = this.easing(raw < 0 ? 0 : raw);
    return true;
  }

  /** Timeline scrub: heights = mix(a, b, t), applied immediately.
   *  Colours stay as they are, so scrubbing years keeps the mode's palette. */
  setHeightMix(a: Float32Array, b: Float32Array, t: number): void {
    if (a.length !== this.count || b.length !== this.count) {
      throw new Error('Mix buffers differ in length from engine');
    }
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    // collapse any running blend, then park both endpoints on the scrubbed
    // state — the scrub is driven by the slider, not by time
    this.captureCurrentAsFrom();
    const h = this.heights;
    for (let i = 0; i < h.length; i++) h[i] = a[i]! + (b[i]! - a[i]!) * tc;
    this.heightsTo.set(h);
    this.colorsTo.set(this.colors);
    this.mixAmount = 1;
    this.animating = false;
    this.version += 1;
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
