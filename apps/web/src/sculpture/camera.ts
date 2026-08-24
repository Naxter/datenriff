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
/** The steepest pitch a frame of this shape can afford.
 *
 *  Germany is taller than it is wide — about 865 km north to south against
 *  640 km east to west. Pitching the camera foreshortens the north–south
 *  axis by `cos(pitch)`, so at 58° the country is drawn as 640 × 458 and
 *  reads as landscape. In a wide frame that is exactly right. In a portrait
 *  one it is the wrong way round: the shape fills the width and leaves a
 *  third of the screen empty above and below it.
 *
 *  Flattening the angle gives that back — at 40° the same country covers
 *  865 × cos(40°) ≈ 663 km of apparent height, half as much again. It is a
 *  cap rather than a value, so a landscape phone and every desktop keep the
 *  angle the sculpture was composed for. */
export function pitchForFrame(pitch: number, width: number, height: number): number {
  if (!isPortraitFrame(width, height)) return pitch;
  return Math.min(pitch, 40);
}

/** Portrait frames are squared up as well as flattened.
 *
 *  The -18 degree turn gives a wide screen its diagonal composition. In a
 *  narrow one it only costs width: the country is presented corner-first, so
 *  the fit has to pull back to keep the corners in, and the sculpture ends up
 *  smaller than the frame could carry. Square-on, it is simply bigger. */
export function bearingForFrame(bearing: number, width: number, height: number): number {
  return isPortraitFrame(width, height) ? 0 : bearing;
}

function isPortraitFrame(width: number, height: number): boolean {
  return width > 0 && height > 0 && width / height < 0.8;
}

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
  const pitch = pitchForFrame(INITIAL_VIEW_STATE.pitch ?? 0, width, height);
  const bearing = bearingForFrame(INITIAL_VIEW_STATE.bearing ?? 0, width, height);
  const base = {
    ...INITIAL_VIEW_STATE,
    longitude: fitted.longitude,
    latitude: fitted.latitude,
    pitch,
    bearing,
  };
  const landscape = width / height;
  // A wide frame has room to come in past the flat fit; a narrow one does not.
  const bump = landscape >= 1.2 ? 0.3 : landscape >= 0.8 ? 0 : -0.15;
  const zoom = fitted.zoom + bump;
  // Only a portrait frame is solved properly. A wide one has been composed by
  // eye against these numbers for months, and its corners are allowed to sit
  // slightly outside — the country's own corners are empty anyway.
  if (!isPortraitFrame(width, height)) return { ...base, zoom };
  const solved = { ...base, zoom: zoomThatFits(base, fitted.zoom, bounds, width, height) };
  return { ...solved, ...centredOn(solved, bounds, width, height) };
}

/** Where to aim so that what is *drawn* sits in the middle of the frame.
 *
 *  `fitBounds` centres the camera on the middle of the bounding box, which is
 *  not the middle of the picture: a pitched camera spreads the near edge and
 *  pushes the country's painted centre below the target. On a phone that left
 *  a visible band of empty paper along the top and almost none at the bottom.
 *  Project what will be drawn, measure where its middle actually lands, and
 *  move the target by the difference. */
function centredOn(
  view: MapViewState,
  bounds: LonLatBounds,
  width: number,
  height: number,
): { longitude: number; latitude: number } {
  const [west, south, east, north] = bounds;
  const viewport = new WebMercatorViewport({ ...view, width, height });
  const ys: number[] = [];
  const xs: number[] = [];
  for (const corner of [
    [west, south],
    [east, south],
    [west, north],
    [east, north],
  ] as [number, number][]) {
    const p = viewport.project(corner);
    const x = p[0];
    const y = p[1];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x as number);
      ys.push(y as number);
    }
  }
  if (ys.length < 4) return { longitude: view.longitude!, latitude: view.latitude! };
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  // aim at the ground point that currently sits where the picture's middle is
  const target = viewport.unproject([
    width / 2 - (midX - width / 2),
    height / 2 - (midY - height / 2),
  ]);
  const longitude = target[0];
  const latitude = target[1];
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? { longitude: longitude as number, latitude: latitude as number }
    : { longitude: view.longitude!, latitude: view.latitude! };
}

/** The largest zoom at or below `start` that still keeps the whole country in
 *  frame, given this pitch and bearing.
 *
 *  `fitBounds` solves for a camera looking straight down. Tilt it and the near
 *  edge spreads sideways; turn it and the diagonal becomes the widest part.
 *  Both make the real footprint wider than the flat solution, which is why the
 *  country was running off the sides of a phone. Rather than guess a constant
 *  to subtract — one that would be wrong on the next screen shape — the
 *  corners are projected and the zoom stepped back until they land inside. */
function zoomThatFits(
  view: MapViewState,
  start: number,
  bounds: LonLatBounds,
  width: number,
  height: number,
): number {
  // Fit an inset box, not the full one. Germany does not reach the corners of
  // its own bounding box — the north-west is the North Sea, the south-east is
  // Austria — so solving for those corners leaves the country visibly small in
  // the frame to protect empty water. A tenth in from each side is still
  // outside anything the sculpture draws.
  const inset = 0.1;
  const [w0, s0, e0, n0] = bounds;
  const west = w0 + (e0 - w0) * inset;
  const east = e0 - (e0 - w0) * inset;
  const south = s0 + (n0 - s0) * inset;
  const north = n0 - (n0 - s0) * inset;
  const corners: [number, number][] = [
    [west, south],
    [east, south],
    [west, north],
    [east, north],
    // the extremes themselves, which are land and must stay in
    [(w0 + e0) / 2, n0],
    [(w0 + e0) / 2, s0],
    [w0, (s0 + n0) / 2],
    [e0, (s0 + n0) / 2],
  ];
  const margin = Math.round(Math.min(width, height) * 0.02);
  let zoom = start;
  for (let step = 0; step < 24; step += 1) {
    const viewport = new WebMercatorViewport({ ...view, width, height, zoom });
    const inside = corners.every((corner) => {
      const projected = viewport.project(corner);
      const x = projected[0] ?? Number.NaN;
      const y = projected[1] ?? Number.NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      return x >= margin && y >= margin && x <= width - margin && y <= height - margin;
    });
    if (inside) return zoom;
    zoom -= 0.06;
  }
  return zoom;
}
