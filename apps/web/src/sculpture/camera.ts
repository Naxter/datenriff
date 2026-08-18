// Isometric, telephoto-like camera; flatter and more poster-like than the
// deck.gl default.

import type { MapViewState } from '@deck.gl/core';

export const CAMERA_FOVY = 24;

export const INITIAL_VIEW_STATE: MapViewState = {
  // slightly north-east of the centroid so the pitched sculpture sits centred
  longitude: 11.2,
  latitude: 52.2,
  zoom: 6.0,
  pitch: 58,
  bearing: -18,
  // controller constraints
  minZoom: 4.6,
  maxZoom: 10.5,
  minPitch: 15,
  maxPitch: 68,
};
