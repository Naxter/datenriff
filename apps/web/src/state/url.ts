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
    const params = new URLSearchParams();
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
