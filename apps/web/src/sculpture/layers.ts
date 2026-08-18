// Layer factory shared by the interactive view and the poster export, so
// both render the identical sculpture.

import { ColumnLayer, PathLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { hexColumnRadius } from '@datenriff/sculpture-core';
import type { CityLabel } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { NeedleExtension } from './needleExtension';
import { COLUMN_TAPER, PLINTH_COLOR, PLINTH_DEPTH_METERS } from './targets';

/** One shared instance: deck compares extensions by value, and a new object
 *  per render would recompile the shader every frame. */
const NEEDLE = new NeedleExtension({ taper: COLUMN_TAPER });

/** `shadowEnabled` is a core layer prop deck reads at runtime, but composite
 *  layers such as TextLayer do not surface it in their typings. Spreading a
 *  non-literal keeps excess-property checking out of the way. */
const SHADOW_OFF = { shadowEnabled: false } as object;

export const INK: [number, number, number, number] = [34, 28, 21, 235];
export const PAPER_HALO: [number, number, number, number] = [247, 240, 234, 235];

/** Slight overlap closes gaps between hex disks. */
export function sculptureRadius(scene: SceneData): number {
  return scene.lod.cellRadiusMeters
    ? scene.lod.cellRadiusMeters * 1.15
    : hexColumnRadius(scene.lod.resolution);
}

export interface SculptureLayerOptions {
  scene: SceneData;
  /** ColumnLayer binary data descriptor; identity change triggers re-upload. */
  data: unknown;
  radius: number;
  labels: CityLabel[];
  characterSet: string[];
  /** Scales label size/offset, e.g. for the 4K poster frame. */
  labelScale?: number;
  /** Country LOD fade during the crossfade to a finer tiled LOD. */
  sculptureOpacity?: number;
  /** Fine-LOD tile layers, drawn between sculpture and labels. */
  fineLayers?: Layer[];
  pickable: boolean;
  onHover?: (info: PickingInfo) => void;
}

export function createSculptureLayers(o: SculptureLayerOptions): Layer[] {
  const plinthData = {
    length: o.scene.count,
    attributes: { getPosition: { value: o.scene.positions, size: 2 } },
  };

  const layers = [
    o.scene.boundary.length > 0 &&
      new PathLayer({
        id: 'outline',
        data: o.scene.boundary,
        getPath: (ring: [number, number][]) => [...ring, ring[0]!],
        getColor: [34, 28, 21, 26],
        getWidth: 1.2,
        widthUnits: 'pixels',
        jointRounded: true,
        shadowEnabled: false,
      }),
    // plinth: the same cells extruded downwards, so the country reads as a
    // slab floating on the paper rather than a field of loose columns
    new ColumnLayer({
      id: 'plinth',
      data: plinthData as unknown as never,
      diskResolution: 6,
      radius: o.radius,
      extruded: true,
      flatShading: true,
      pickable: false,
      // deck.gl skips columns with a negative elevation, so flip the scale
      getElevation: PLINTH_DEPTH_METERS,
      elevationScale: -1,
      getFillColor: [...PLINTH_COLOR, 255],
      material: {
        ambient: 0.7,
        diffuse: 0.42,
        shininess: 40,
        specularColor: [30, 27, 24],
      },
    }),
    new ColumnLayer({
      id: 'sculpture',
      // binary attribute objects are supported but typed loosely
      data: o.data as never,
      diskResolution: 6,
      radius: o.radius,
      extruded: true,
      flatShading: true,
      pickable: o.pickable,
      opacity: o.sculptureOpacity ?? 1,
      visible: (o.sculptureOpacity ?? 1) > 0.02,
      extensions: [NEEDLE],
      material: {
        ambient: 0.64,
        diffuse: 0.52,
        shininess: 110,
        specularColor: [46, 42, 38],
      },
      onHover: o.onHover,
    }),
    ...(o.fineLayers ?? []),
    new TextLayer<CityLabel>({
      id: 'labels',
      data: o.labels,
      characterSet: o.characterSet,
      billboard: true,
      sizeUnits: 'pixels',
      getPosition: (d) => [d.lon, d.lat],
      getText: (d) => d.name.toUpperCase(),
      getSize: (d) => (d.tier === 1 ? 12.5 : 11) * (o.labelScale ?? 1),
      getColor: INK,
      getPixelOffset: [0, -14 * (o.labelScale ?? 1)],
      updateTriggers: { getSize: o.labelScale, getPixelOffset: o.labelScale },
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: 600,
      fontSettings: { sdf: true, fontSize: 128, buffer: 8, radius: 12 },
      outlineWidth: 6,
      outlineColor: PAPER_HALO,
      // the font atlas must not take part in the shadow pass: deck 9.1 binds
      // it into the shadow sampler slot and every layer then fails to draw
      ...SHADOW_OFF,
      // labels sit on the paper plane; draw them over the columns like a
      // poster overlay
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
    }),
  ];
  return layers.filter(Boolean) as Layer[];
}

export function labelCharacterSet(cities: CityLabel[]): string[] {
  const chars = new Set<string>();
  for (const c of cities) for (const ch of c.name.toUpperCase()) chars.add(ch);
  return [...chars];
}
