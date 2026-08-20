// Isometric, telephoto-like camera; flatter and more poster-like than the
// deck.gl default.

import { WebMercatorViewport, type MapViewState } from '@deck.gl/core';
import type { LonLatBounds } from '@datenriff/data-contracts';

export const CAMERA_FOVY = 24;

export const INITIAL_VIEW_STATE: MapViewState = {
  // slightly north-east of the centroid so the pitched sculpture sits centred
  longitude: 10.9,
  latitude: 52.2,
  zoom: 6.1,
  pitch: 58,
  bearing: -18,
  // controller constraints
  minZoom: 4.6,
  // 12 is a district: ~10 km across, where the r10 (100 m) cells resolve
  maxZoom: 12,
  minPitch: 15,
  maxPitch: 68,
};

/** Zoom levels above the country framing before columns start to shrink. */
const HEIGHT_FALLOFF_START = 0.3;
/** Halvings of column height per zoom level beyond that. */
export const HEIGHT_FALLOFF = 0.75;
/** The same, where the fine levels carry a count per unit area: a 66 m cell
 *  then stands for forty-nine times the metres per person of the country
 *  level, and a city would leave the frame (measured: 1.77 million metres
 *  for the densest cell). The steeper falloff pays that back over the zoom
 *  range instead of clipping the tops off. */
export const DENSITY_HEIGHT_FALLOFF = 1.35;

/** Columns are calibrated for the country view: a 100 km peak reads as a
 *  needle over 900 km of country. Closing in on a city, that same peak
 *  would fill the frame from bottom to top, so height eases down with zoom
 *  — relative to the fitted country zoom, so a 4K window is not already
 *  "zoomed in" at rest. */
export function zoomHeightScale(
  zoom: number,
  countryZoom: number,
  falloff: number = HEIGHT_FALLOFF,
): number {
  const over = zoom - countryZoom - HEIGHT_FALLOFF_START;
  return over <= 0 ? 1 : Math.pow(2, -over * falloff);
}

/** Composed camera stops above the country framing: a Bundesland-sized
 *  frame and a city. Each belongs to exactly one level of detail — 8.6 sits
 *  well inside the 175 m level (7.0–10.2), 10.9 inside the 66 m level — so a
 *  reader can never come to rest in a handover. The country stop is the
 *  fitted view and depends on the window. */
const STOPS_ABOVE_COUNTRY = [8.6, 10.9];

/** The stops for this window. A stop too close to the country fit would be
 *  a step that changes nothing, so it is dropped. */
export function cameraStops(countryZoom: number): number[] {
  return [countryZoom, ...STOPS_ABOVE_COUNTRY.filter((z) => z > countryZoom + 0.6)];
}

/** Zoom is absolute in Mercator, so a fixed default crops small windows and
 *  wastes paper on large ones. Fit the dataset bounds to the viewport instead:
 *  the crust only resolves into individual needles when the sculpture is big
 *  in frame, which is most of what separates a render from a poster. */
export function fitViewState(
  bounds: LonLatBounds,
  width: number,
  height: number,
): MapViewState {
  const [west, south, east, north] = bounds;
  if (!(width > 0 && height > 0)) return INITIAL_VIEW_STATE;
  const fitted = new WebMercatorViewport({ width, height }).fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: Math.round(Math.min(width, height) * 0.04) },
  );
  // fitBounds assumes a top-down camera. Pitching compresses the footprint
  // vertically, so a wide frame has room to zoom in past the flat fit; a
  // portrait frame does not — there the pitched near edge spills sideways.
  const landscape = width / height;
  const bump = landscape >= 1.2 ? 0.3 : landscape >= 0.8 ? 0 : -0.15;
  return {
    ...INITIAL_VIEW_STATE,
    longitude: fitted.longitude,
    latitude: fitted.latitude,
    zoom: fitted.zoom + bump,
  };
}
