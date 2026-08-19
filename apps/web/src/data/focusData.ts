// State outlines (BKG VG2500) for FOCUS, loaded once on first use, and the
// city choices from the label file. Nothing here touches the sculpture; it
// only builds `FocusGeometry` values.

import type { AtlasManifest, CityLabel } from '@datenriff/data-contracts';
import type { SceneData } from './loader';
import { CITY_RADIUS_KM, type FocusGeometry, type StatesFile } from '../sculpture/focus';

let statesPromise: Promise<StatesFile | null> | null = null;

export function loadStates(manifest: AtlasManifest): Promise<StatesFile | null> {
  if (!manifest.states) return Promise.resolve(null);
  if (!statesPromise) {
    statesPromise = fetch(manifest.states)
      .then((res) => (res.ok ? (res.json() as Promise<StatesFile>) : null))
      .catch(() => null);
  }
  return statesPromise;
}

let outlinePromise: Promise<[number, number][][] | null> | null = null;

/** The national border (BKG VG2500), fetched the first time a viewer asks
 *  for it. 130 KB that the default view has no use for. */
export function loadOutline(manifest: AtlasManifest): Promise<[number, number][][] | null> {
  if (!manifest.outline) return Promise.resolve(null);
  if (!outlinePromise) {
    outlinePromise = fetch(manifest.outline)
      .then((res) => (res.ok ? (res.json() as Promise<{ rings: [number, number][][] }>) : null))
      .then((file) => file?.rings ?? null)
      .catch(() => null);
  }
  return outlinePromise;
}

export function cityFocus(city: CityLabel): FocusGeometry {
  return {
    kind: 'city',
    id: city.name,
    name: city.name,
    lon: city.lon,
    lat: city.lat,
    radiusKm: CITY_RADIUS_KM,
  };
}

export function stateFocus(state: StatesFile['states'][number]): FocusGeometry {
  return { kind: 'state', id: state.id, name: state.name, bbox: state.bbox, rings: state.rings };
}

/** Cities offered for focus: the ones that carry a label at country zoom
 *  plus the next tier, so the list stays a list and not a gazetteer. */
export function focusCities(scene: SceneData): CityLabel[] {
  return scene.cities.filter((c) => c.tier <= 2).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** `state:DE-09` / `city:München` from the URL → geometry, or null. */
export async function resolveFocus(
  spec: string,
  manifest: AtlasManifest,
  scene: SceneData,
): Promise<FocusGeometry | null> {
  const [kind, ...rest] = spec.split(':');
  const id = decodeURIComponent(rest.join(':'));
  if (kind === 'city') {
    const city = scene.cities.find((c) => c.name === id);
    return city ? cityFocus(city) : null;
  }
  if (kind === 'state') {
    const file = await loadStates(manifest);
    const state = file?.states.find((s) => s.id === id);
    return state ? stateFocus(state) : null;
  }
  return null;
}
