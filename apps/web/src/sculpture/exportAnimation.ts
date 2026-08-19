// Animated export: the timeline played out as a GIF.
//
// A poster freezes one year; a mode with a timeline is about the years
// changing, and a GIF is what a slide deck can actually hold. Frames come
// from the same capture path as the poster — the live deck resized for one
// frame — so what you export is what you saw.
//
// GIF is 256 colours per frame. The atlas is paper plus one ramp, so the
// quantiser has an easy job; a photo would not survive this well.

import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { SculptureMode } from '@datenriff/data-contracts';
import { requestSculptureCapture, type ExportFormat } from './exportBridge';
import { renderPoster, type PosterContext } from './exportPoster';

export interface AnimationOptions {
  /** Frames across the whole timeline. */
  frames: number;
  /** Milliseconds per frame. */
  delay: number;
  /** Longest edge in pixels; GIFs get heavy fast. */
  maxEdge: number;
}

export const ANIMATION_PRESETS: { id: string; label: string; options: AnimationOptions }[] = [
  { id: 'small', label: '640 px', options: { frames: 16, delay: 220, maxEdge: 640 } },
  { id: 'medium', label: '960 px', options: { frames: 24, delay: 180, maxEdge: 960 } },
  { id: 'large', label: '1280 px', options: { frames: 32, delay: 150, maxEdge: 1280 } },
];

/** Steps the timeline, captures each frame and encodes a GIF.
 *  `onProgress` reports 0…1 so the dialog can show it moving. */
export async function renderAnimation(
  mode: SculptureMode,
  format: ExportFormat,
  ctx: PosterContext,
  options: AnimationOptions,
  setTimeT: (t: number) => void,
  currentTimeT: () => number,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  if (!mode.time || mode.time.steps.length < 2) {
    throw new Error('This mode has no timeline to animate');
  }
  const dpr = options.maxEdge / Math.max(format.width, format.height);
  const encoder = GIFEncoder();
  const restore = currentTimeT();

  try {
    for (let i = 0; i < options.frames; i++) {
      const t = options.frames === 1 ? 1 : i / (options.frames - 1);
      setTimeT(t);
      // the scrub is a uniform, not an animation: one frame is enough for
      // the new mix to be on screen
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const captured = await requestSculptureCapture(format, dpr);
      // each frame is a different year, so its poster furniture — the date
      // and the legend's metric — has to be that year's, not the context's
      const poster = await renderPoster(captured, { ...ctx, timeT: t }, format, dpr);
      const c2d = poster.getContext('2d');
      if (!c2d) throw new Error('no 2d context for the animation frame');
      const { data, width, height } = c2d.getImageData(0, 0, poster.width, poster.height);
      const palette = quantize(data, 256, { format: 'rgb444' });
      const index = applyPalette(data, palette, 'rgb444');
      encoder.writeFrame(index, width, height, { palette, delay: options.delay });
      onProgress?.((i + 1) / options.frames);
    }
  } finally {
    setTimeT(restore);
  }
  encoder.finish();
  return encoder.bytes();
}

export function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
