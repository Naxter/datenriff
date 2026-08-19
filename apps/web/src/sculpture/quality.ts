// Quality profiles (plan §116/§117). A phone cannot render the desktop
// country LOD with shadows at full device pixel ratio, and it should not
// try: the atlas drops to a coarser H3 resolution instead of dropping
// frames. Everything that costs GPU time is decided here, in one place.

import type { SculptureDataset, SculptureLOD } from '@datenriff/data-contracts';
import type { Settings, Tri } from '../state/settings';

export type QualityId = 'mobile' | 'desktop';

export interface QualityProfile {
  id: QualityId;
  /** Cap on device pixels; phones lie about how many they can afford. */
  maxDevicePixelRatio: number;
  /** The shadow pass roughly doubles the geometry cost. */
  shadows: boolean;
  /** Highest city-label tier to draw at country zoom. */
  maxLabelTier: number;
  /** Stream the finer tiled LODs on zoom. */
  streamTiles: boolean;
  /** Prefer the coarsest country LOD (r7) over the finest (r8). */
  coarseCountryLod: boolean;
}

const DESKTOP: QualityProfile = {
  id: 'desktop',
  maxDevicePixelRatio: 2,
  shadows: true,
  maxLabelTier: 3,
  streamTiles: true,
  coarseCountryLod: false,
};

const MOBILE: QualityProfile = {
  id: 'mobile',
  maxDevicePixelRatio: 1.5,
  shadows: false,
  maxLabelTier: 1,
  streamTiles: false,
  coarseCountryLod: true,
};

/** `?quality=mobile|desktop` overrides everything (how it is tested), then
 *  the viewer's setting, then device detection. */
export function detectQuality(setting: Settings['quality'] = 'auto'): QualityProfile {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced === 'mobile') return MOBILE;
  if (forced === 'desktop') return DESKTOP;
  if (setting === 'mobile') return MOBILE;
  if (setting === 'desktop') return DESKTOP;
  const smallScreen = window.matchMedia('(max-width: 760px)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  return smallScreen || (coarsePointer && fewCores) ? MOBILE : DESKTOP;
}

/** Shadows: `?shadows=0` wins (software renderers cannot run the shadow
 *  pass), then the viewer's setting, then the profile. */
export function shadowsEnabled(profile: QualityProfile, setting: Tri = 'auto'): boolean {
  if (new URLSearchParams(window.location.search).get('shadows') === '0') {
    return false;
  }
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return profile.shadows;
}

/** Can this page run the shadow pass at all? Decided once, at mount: the
 *  pass has to exist in the LightingEffect from the start, and swapping the
 *  effect later leaves deck 9.1 holding stale shadow bindings. Creating it
 *  whenever the device could plausibly want shadows means the viewer's
 *  on/off is only the shadow ink, which needs no reload. */
export function shadowPassPossible(profile: QualityProfile, setting: Tri = 'auto'): boolean {
  if (new URLSearchParams(window.location.search).get('shadows') === '0') {
    return false;
  }
  return profile.shadows || setting === 'on';
}

/** City-label tier cap: the setting, else the profile's. 0 = no labels. */
export function labelTierCap(profile: QualityProfile, setting: Settings['labels'] = 'auto'): number {
  if (setting === 'none') return 0;
  if (setting === 'major') return 1;
  if (setting === 'all') return 3;
  return profile.maxLabelTier;
}

/** Country LOD for a profile.
 *
 *  Candidates are the whole-country buffer sets that are *not* tiled: a
 *  tiled LOD also ships whole-LOD buffers (the tiles are sliced from them),
 *  but loading 830k cells up front is exactly what tiling exists to avoid.
 *  Mobile then takes the coarsest of the candidates (r7), desktop the
 *  finest (r8). */
export function pickCountryLod(
  dataset: SculptureDataset,
  profile: QualityProfile,
): SculptureLOD | undefined {
  const candidates = dataset.lods
    .filter((l) => l.positions && l.metricTemplate && !l.tileIndex)
    .sort((a, b) => a.resolution - b.resolution);
  if (candidates.length === 0) return undefined;
  return profile.coarseCountryLod ? candidates[0] : candidates[candidates.length - 1];
}
