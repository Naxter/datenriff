// Every view is shareable:
//   ?mode=change&t=0.5&palette=glacier&view=10.40,51.20,5.80,58,-18&focus=state:DE-09

import type { MapViewState } from '@deck.gl/core';

export interface UrlState {
  modeId?: string;
  timeT?: number;
  palette?: string;
  view?: Partial<MapViewState>;
  /** `state:<id>` or `city:<name>`, resolved against the loaded data. */
  focus?: string;
}

/** The query as the page was opened, frozen.
 *
 *  The view state rewrites the URL as you pan, so anything read from
 *  `window.location.search` later is reading a moving target. Flags that
 *  decide how the page was *launched* — shadows, quality, language, intro —
 *  must come from here, or a shadow pass can be switched on under a page
 *  that was started without one, which reloads it. */
const LAUNCH = new URLSearchParams(window.location.search);

export function launchParam(name: string): string | null {
  return LAUNCH.get(name);
}

/** The whole frozen query, for callers that read several flags at once. */
export function launchParams(): URLSearchParams {
  return new URLSearchParams(LAUNCH);
}

export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const state: UrlState = {};
  const mode = params.get('mode');
  if (mode) state.modeId = mode;
  const t = params.get('t');
  if (t !== null && !Number.isNaN(Number(t))) {
    state.timeT = Math.min(1, Math.max(0, Number(t)));
  }
  const palette = params.get('palette');
  if (palette) state.palette = palette;
  const focus = params.get('focus');
  if (focus && /^(state|city):.+/.test(focus)) state.focus = focus;
  const view = params.get('view');
  if (view) {
    const parts = view.split(',').map(Number);
    if (parts.length === 5 && parts.every((v) => Number.isFinite(v))) {
      const [longitude, latitude, zoom, pitch, bearing] = parts as [
        number, number, number, number, number,
      ];
      state.view = { longitude, latitude, zoom, pitch, bearing };
    }
  }
  return state;
}

let writeTimer: ReturnType<typeof setTimeout> | undefined;

export function writeUrlState(
  modeId: string,
  timeT: number,
  palette: string | null,
  view: MapViewState,
  focus: string | null = null,
): void {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    // Start from what is already there. Rebuilding from scratch silently
    // dropped every flag this function does not know about — ?shadows=0,
    // ?quality=, ?intro=, ?lang= — 350 ms after load, which made them
    // useless for the very testing they exist for.
    const params = new URLSearchParams(window.location.search);
    params.delete('t');
    params.delete('palette');
    params.delete('focus');
    params.set('mode', modeId);
    if (timeT < 1) params.set('t', timeT.toFixed(2));
    if (palette) params.set('palette', palette);
    if (focus) params.set('focus', focus);
    params.set(
      'view',
      [
        view.longitude.toFixed(3),
        view.latitude.toFixed(3),
        view.zoom.toFixed(2),
        (view.pitch ?? 0).toFixed(0),
        (view.bearing ?? 0).toFixed(0),
      ].join(','),
    );
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, 350);
}
