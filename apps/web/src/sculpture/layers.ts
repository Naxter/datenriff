// Layer factory shared by the interactive view and the poster export, so
// both render the identical sculpture.

import { ColumnLayer, PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { MorphColumnLayer, type FadeBox } from './morphColumnLayer';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { hexColumnRadius } from '@datenriff/sculpture-core';
import type { CityLabel } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { NeedleExtension } from './needleExtension';
import { COLUMN_TAPER } from './targets';

/** One shared instance: deck compares extensions by value, and a new object
 *  per render would recompile the shader every frame. */
const NEEDLE = new NeedleExtension({ taper: COLUMN_TAPER });

/** `shadowEnabled` is a core layer prop deck reads at runtime, but composite
 *  layers such as TextLayer do not surface it in their typings. Spreading a
 *  non-literal keeps excess-property checking out of the way. */
const SHADOW_OFF = { shadowEnabled: false } as object;

/** The face the label atlas is baked from.
 *
 *  Weight 500, not 600: uppercase in a heavy sans with a thick halo read as
 *  stickers laid over the sculpture, where the reference asks for few names,
 *  quietly printed. The titles' serif was tried here and lost — it is a
 *  display face, and at label size its hairlines dissolve into the columns.
 *
 *  Every weight is its own file, so the check has to name this one exactly.
 *  See `labelFaceReady`. */
export const LABEL_FONT_FAMILY = 'Inter, system-ui, sans-serif';
export const LABEL_FONT_WEIGHT = 500;
export const LABEL_FONT_CHECK = `${LABEL_FONT_WEIGHT} 16px Inter`;

/** Wait until the label face is really there.
 *
 *  Asking early is worse than not asking: until the stylesheet is parsed
 *  `document.fonts` holds no faces at all, and `check()` then answers *true*
 *  — with nothing to match, a fallback counts as available. Measured here:
 *  at 7 ms zero faces and check true, at 137 ms ten faces and check false,
 *  at ~1 s the file has landed. A layer built inside that first window bakes
 *  its atlas from the fallback and keeps it.
 *
 *  Resolves true if the face arrived, false if the wait ran out. */
export async function labelFaceReady(timeoutMs = 2500): Promise<boolean> {
  if (!document.fonts) return true;
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) =>
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }),
    );
  }
  const deadline = performance.now() + timeoutMs;
  try {
    await document.fonts.load(LABEL_FONT_CHECK);
  } catch {
    // no network for it; fall through to the poll and then to the fallback
  }
  while (!document.fonts.check(LABEL_FONT_CHECK) && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return document.fonts.check(LABEL_FONT_CHECK);
}

/** TextLayer is composite: the glyphs render in a `characters` sub-layer,
 *  which does not inherit `shadowEnabled` — the label font atlas then gets
 *  drawn into the shadow map and city names appear as giant letters on the
 *  ground plane. Opt every sub-layer out explicitly. */
const TEXT_SHADOW_OFF = {
  ...SHADOW_OFF,
  _subLayerProps: {
    characters: { shadowEnabled: false },
    background: { shadowEnabled: false },
  },
} as object;

export const INK: [number, number, number, number] = [34, 28, 21, 235];
export const PAPER_HALO: [number, number, number, number] = [247, 240, 234, 235];
/** City names carry less ink than the outline and the labels of the
 *  interface: they name the place without competing with the sculpture. */
export const LABEL_INK: [number, number, number, number] = [34, 28, 21, 225];
/** The page background, so the ground plane disappears into the paper. */
export const PAPER: [number, number, number, number] = [247, 240, 234, 255];

/** Slight overlap closes gaps between hex disks. */
export function sculptureRadius(scene: SceneData): number {
  return scene.lod.cellRadiusMeters
    ? scene.lod.cellRadiusMeters * 1.15
    : hexColumnRadius(scene.lod.resolution);
}

const COLUMN_MATERIAL = {
  ambient: 0.64,
  diffuse: 0.52,
  shininess: 110,
  specularColor: [46, 42, 38] as [number, number, number],
};

export interface ColumnLayerOptions {
  id: string;
  /** ColumnLayer binary data descriptor; identity change triggers re-upload. */
  data: unknown;
  /** Eased blend between the from/to attribute pairs, moved by the engine. */
  mixAmount?: number;
  radius: number;
  opacity?: number;
  /** Zoom-dependent height factor (see `zoomHeightScale`). */
  elevationScale?: number;
  /** Region handed over to finer tiles (distance LOD); null = none. */
  fadeBox?: FadeBox | null;
  pickable: boolean;
  onHover?: (info: PickingInfo) => void;
}

/** The morphing column sculpture itself; also used for the sculpture being
 *  replaced during a dataset switch, which sinks back into the plane. */
export function createColumnLayer(o: ColumnLayerOptions): Layer {
  return new MorphColumnLayer({
    id: o.id,
    // binary attribute objects are supported but typed loosely
    data: o.data as never,
    // both endpoints live on the GPU; only this uniform moves per frame
    mixAmount: o.mixAmount ?? 1,
    fadeBox: o.fadeBox ?? null,
    diskResolution: 6,
    radius: o.radius,
    elevationScale: o.elevationScale ?? 1,
    extruded: true,
    flatShading: true,
    pickable: o.pickable,
    opacity: o.opacity ?? 1,
    visible: (o.opacity ?? 1) > 0.02,
    extensions: [NEEDLE],
    material: COLUMN_MATERIAL,
    onHover: o.onHover,
  });
}

export interface SculptureLayerOptions {
  scene: SceneData;
  /** ColumnLayer binary data descriptor; identity change triggers re-upload. */
  data: unknown;
  /** Eased blend between the from/to attribute pairs, moved by the engine. */
  mixAmount?: number;
  radius: number;
  labels: CityLabel[];
  characterSet: string[];
  /** Bumped when the label face arrives late; re-bakes the glyph atlas. */
  labelFontEpoch?: number;
  /** Scales label size/offset, e.g. for the 4K poster frame. */
  labelScale?: number;
  /** Labels fade in last during the opening sequence. */
  labelOpacity?: number;
  /** Where the country LOD yields to fine tiles, and how far it has faded. */
  fadeBox?: FadeBox | null;
  /** Zoom-dependent height factor, shared by every column layer. */
  elevationScale?: number;
  /** The previous dataset's sculpture while it sinks away, drawn under the
   *  new one. */
  outgoingLayer?: Layer;
  /** Fine-LOD tile layers, drawn between sculpture and labels. */
  fineLayers?: Layer[];
  /** Optional outline of the country, off unless the viewer asks for it. */
  border?: { color: [number, number, number]; rings: [number, number][][] } | null;
  pickable: boolean;
  onHover?: (info: PickingInfo) => void;
}

export function createSculptureLayers(o: SculptureLayerOptions): Layer[] {
  // Ground plane: paper-coloured, spanning well past the country. It is
  // invisible against the page but catches the columns' shadows, which is
  // what the editorial reference does — needles standing on paper. It
  // replaces the earlier grey slab, whose top showed through every gap
  // between tapered columns as a dull crust.
  const [w, s, e, n] = o.scene.lod.bounds;
  const pad = 6;
  const ground = [
    [w - pad, s - pad],
    [e + pad, s - pad],
    [e + pad, n + pad],
    [w - pad, n + pad],
  ] as [number, number][];

  const layers = [
    new SolidPolygonLayer({
      id: 'ground',
      data: [{ polygon: ground }],
      getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
      getFillColor: PAPER,
      pickable: false,
      // no self-shadowing on a flat plane; it only receives
      ...SHADOW_OFF,
      material: { ambient: 1, diffuse: 0, shininess: 1, specularColor: [0, 0, 0] },
    }),
    // The country outline is off by default — the columns draw the land, and
    // that is the point of the thing. It earns its place on a sparse mode,
    // where the coast is hard to read from the data alone.
    o.border && o.border.rings.length > 0
      ? new PathLayer({
          id: 'border',
          data: o.border.rings,
          getPath: (ring: [number, number][]) => ring,
          getColor: o.border.color,
          getWidth: 1.4,
          widthUnits: 'pixels',
          widthMinPixels: 1,
          parameters: { depthCompare: 'always' },
          pickable: false,
          ...SHADOW_OFF,
        })
      : undefined,
    o.outgoingLayer,
    createColumnLayer({
      id: 'sculpture',
      data: o.data,
      mixAmount: o.mixAmount,
      radius: o.radius,
      elevationScale: o.elevationScale,
      fadeBox: o.fadeBox,
      pickable: o.pickable,
      onHover: o.onHover,
    }),
    ...(o.fineLayers ?? []),
    // Nothing to label, no layer: an empty TextLayer still bakes its glyph
    // atlas from `characterSet` and caches it, so holding the labels back by
    // handing over an empty list would bake the fallback face anyway — the
    // very thing `labelFaceReady` exists to avoid.
    o.labels.length === 0
      ? undefined
      : new TextLayer<CityLabel>({
      id: 'labels',
      data: o.labels,
      characterSet: o.characterSet,
      billboard: true,
      sizeUnits: 'pixels',
      getPosition: (d) => [d.lon, d.lat],
      // mixed case, not capitals: a name set like a caption sits on the
      // paper instead of standing on the sculpture
      getText: (d) => d.name,
      getSize: (d) => (d.tier === 1 ? 12.5 : 11) * (o.labelScale ?? 1),
      getColor: LABEL_INK,
      opacity: o.labelOpacity ?? 1,
      visible: (o.labelOpacity ?? 1) > 0.01,
      getPixelOffset: [0, -20 * (o.labelScale ?? 1)],
      updateTriggers: { getSize: o.labelScale, getPixelOffset: o.labelScale },
      fontFamily: LABEL_FONT_FAMILY,
      fontWeight: LABEL_FONT_WEIGHT,
      // radius takes part in deck's atlas cache key (family, weight, size,
      // buffer, radius, cutoff), so a hair of change re-bakes the atlas —
      // which is how labels baked from the fallback are replaced once the
      // real face lands. The step is far below anything visible.
      fontSettings: {
        sdf: true,
        fontSize: 128,
        buffer: 8,
        radius: 12 + (o.labelFontEpoch ?? 0) * 0.001,
      },
      outlineWidth: 6,
      outlineColor: PAPER_HALO,
      // the font atlas must not take part in the shadow pass (sampler
      // corruption in 9.1, and letter-shaped shadows on the ground plane)
      ...TEXT_SHADOW_OFF,
      // labels sit on the paper plane; draw them over the columns like a
      // poster overlay
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
    }),
  ];
  return layers.filter(Boolean) as Layer[];
}

export function labelCharacterSet(cities: CityLabel[]): string[] {
  const chars = new Set<string>();
  // exactly the characters that will be drawn: the names are set as they are
  // written, so an atlas built from capitals would be missing every
  // lowercase letter and every umlaut in its lowercase form
  for (const c of cities) for (const ch of c.name) chars.add(ch);
  return [...chars];
}
