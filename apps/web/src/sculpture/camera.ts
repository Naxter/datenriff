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
  maxZoom: 10.5,
  minPitch: 15,
  maxPitch: 68,
};

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
  return {
    ...INITIAL_VIEW_STATE,
    longitude: fitted.longitude,
    latitude: fitted.latitude,
    // fitBounds assumes a top-down camera; pitching compresses the footprint
    // vertically, so there is room to zoom in past the flat fit — minus a
    // little headroom for the tallest columns
    zoom: fitted.zoom + 0.3,
  };
}
