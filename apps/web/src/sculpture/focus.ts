// FOCUS: one state or one city stands out, everything else steps back —
// colours toward paper, heights lowered — so a region reads on its own
// without leaving the country. Pure geometry here (used by the main thread
// for the country LOD and by the tile worker for the fine tiles).

import type { LonLatBounds } from '@datenriff/data-contracts';

/** A state's outline: every ring, outer and holes, tested even-odd. */
export interface StateShape {
  id: string;
  name: string;
  bbox: LonLatBounds;
  rings: [number, number][][];
}

export interface StatesFile {
  attribution: string;
  license: string;
  url: string;
  states: StateShape[];
}

/** What is in focus: a state by outline, or a city by radius. */
export type FocusGeometry =
  | { kind: 'state'; id: string; name: string; bbox: LonLatBounds; rings: [number, number][][] }
  | { kind: 'city'; id: string; name: string; lon: number; lat: number; radiusKm: number };

/** Radius that makes a city focus (centre plus its commuter belt). */
export const CITY_RADIUS_KM = 22;

/** How far the rest of the country steps back. */
export const FOCUS_HEIGHT = 0.28;
export const FOCUS_PAPER_MIX = 0.72;
const PAPER: [number, number, number] = [247, 240, 234];

export function focusKey(f: FocusGeometry | null): string {
  return f ? `${f.kind}:${f.id}` : '';
}

export function pointInRings(lon: number, lat: number, rings: [number, number][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Bounding box of a city focus, for the camera and tile zone. */
export function focusBounds(f: FocusGeometry): LonLatBounds {
  if (f.kind === 'state') return f.bbox;
  const dLat = f.radiusKm / 111.32;
  const dLon = dLat / Math.cos((f.lat * Math.PI) / 180);
  return [f.lon - dLon, f.lat - dLat, f.lon + dLon, f.lat + dLat];
}

/** Per-cell mask over interleaved lon/lat positions: 1 = in focus. */
export function focusMask(positions: Float32Array, f: FocusGeometry): Uint8Array {
  const n = positions.length / 2;
  const mask = new Uint8Array(n);
  if (f.kind === 'city') {
    const kx = Math.cos((f.lat * Math.PI) / 180) * 111.32;
    const ky = 111.32;
    const r2 = f.radiusKm * f.radiusKm;
    for (let i = 0; i < n; i++) {
      const dx = (positions[2 * i]! - f.lon) * kx;
      const dy = (positions[2 * i + 1]! - f.lat) * ky;
      if (dx * dx + dy * dy <= r2) mask[i] = 1;
    }
    return mask;
  }
  const [w, s, e, nb] = f.bbox;
  for (let i = 0; i < n; i++) {
    const lon = positions[2 * i]!;
    const lat = positions[2 * i + 1]!;
    if (lon < w || lon > e || lat < s || lat > nb) continue;
    if (pointInRings(lon, lat, f.rings)) mask[i] = 1;
  }
  return mask;
}

/** Apply the focus to height and colour buffers in place. */
export function applyFocus(heights: Float32Array, colors: Uint8Array, mask: Uint8Array): void {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue;
    heights[i] = heights[i]! * FOCUS_HEIGHT;
    const o = i * 4;
    colors[o] = colors[o]! + (PAPER[0] - colors[o]!) * FOCUS_PAPER_MIX;
    colors[o + 1] = colors[o + 1]! + (PAPER[1] - colors[o + 1]!) * FOCUS_PAPER_MIX;
    colors[o + 2] = colors[o + 2]! + (PAPER[2] - colors[o + 2]!) * FOCUS_PAPER_MIX;
  }
}
