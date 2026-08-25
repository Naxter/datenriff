// GPU morph between two sculptures.
//
// The CPU path rewrites every elevation and colour on each frame of a
// transition — at 272k cells that is ~1.4 M float writes plus a full buffer
// re-upload per frame, just to show an eased blend of two states we already
// have. Here both states sit on the GPU as attributes and a single uniform
// moves:
//
//     elevation = mix(from, to, mixAmount)
//     colour    = mix(from, to, mixAmount)
//
// ColumnLayer reads `instanceElevations` and `instanceFillColors` before any
// injection hook runs, and GLSL attributes are read-only, so the blend has
// to be patched into the shader source. The patch is anchored on exact
// strings from deck 9.1's column shader and throws if they disappear — a
// loud failure on upgrade beats a silently frozen sculpture.

import { ColumnLayer } from '@deck.gl/layers';
import type { ColumnLayerProps } from '@deck.gl/layers';
import type { Accessor, DefaultProps } from '@deck.gl/core';

// The fade box is the distance LOD: inside it the country columns step
// aside for the fine tiles (alpha → fadeOpacity), feathering back to full
// over fadeMargin so the seam between resolutions is a gradient, not a wall.
const MORPH_UNIFORMS = `\
uniform morphUniforms {
  float mixAmount;
  float fadeOpacity;
  vec2 fadeMin;
  vec2 fadeMax;
  vec2 fadeMargin;
} morph;
`;

const morphUniforms = {
  name: 'morph' as const,
  vs: MORPH_UNIFORMS,
  uniformTypes: {
    mixAmount: 'f32',
    fadeOpacity: 'f32',
    fadeMin: 'vec2<f32>',
    fadeMax: 'vec2<f32>',
    fadeMargin: 'vec2<f32>',
  },
};

/** Lon/lat box inside which the layer fades to `opacity`, with a feather. */
export interface FadeBox {
  bounds: [number, number, number, number];
  /** Feather width in degrees, [lon, lat]. */
  margin: [number, number];
  opacity: number;
}

/** Anchors in deck 9.1's column-layer vertex shader. */
const COLOR_ANCHOR =
  'vec4 color = column.isStroke ? instanceLineColors : instanceFillColors;';
const ELEVATION_ANCHOR =
  'elevation = instanceElevations * (positions.z + 1.0) / 2.0 * column.elevationScale;';
const RENDER_ANCHOR =
  'float shouldRender = float(color.a > 0.0 && instanceElevations >= 0.0);';

export function patchColumnShader(vs: string): string {
  for (const anchor of [COLOR_ANCHOR, ELEVATION_ANCHOR, RENDER_ANCHOR]) {
    if (!vs.includes(anchor)) {
      throw new Error(
        `MorphColumnLayer: deck.gl's column shader changed, anchor missing:\n${anchor}`,
      );
    }
  }
  return vs
    .replace(
      'in vec4 instanceLineColors;',
      `in vec4 instanceLineColors;
in float instanceElevationsTo;
in vec4 instanceFillColorsTo;`,
    )
    .replace(
      COLOR_ANCHOR,
      `float morph_elevation = mix(instanceElevations, instanceElevationsTo, morph.mixAmount);
vec4 morph_fill = mix(instanceFillColors, instanceFillColorsTo, morph.mixAmount);
if (morph.fadeOpacity < 1.0) {
  vec2 morph_out = max(morph.fadeMin - instancePositions.xy, instancePositions.xy - morph.fadeMax);
  float morph_d = max(morph_out.x / morph.fadeMargin.x, morph_out.y / morph.fadeMargin.y);
  morph_fill.a *= mix(morph.fadeOpacity, 1.0, clamp(morph_d, 0.0, 1.0));
}
vec4 color = column.isStroke ? instanceLineColors : morph_fill;`,
    )
    .replace(
      ELEVATION_ANCHOR,
      'elevation = morph_elevation * (positions.z + 1.0) / 2.0 * column.elevationScale;',
    )
    .replace(
      RENDER_ANCHOR,
      'float shouldRender = float(color.a > 0.0 && morph_elevation >= 0.0);',
    );
}

export interface MorphColumnLayerProps<DataT = unknown>
  extends ColumnLayerProps<DataT> {
  /** 0 = the `from` buffers, 1 = the `to` buffers. */
  mixAmount?: number;
  /** Region handed over to finer tiles; null = draw everywhere. */
  fadeBox?: FadeBox | null;
  getElevationTo?: Accessor<DataT, number>;
  getFillColorTo?: Accessor<DataT, [number, number, number, number]>;
}

const defaultProps: DefaultProps<MorphColumnLayerProps> = {
  mixAmount: { type: 'number', value: 1, min: 0, max: 1 },
  fadeBox: { type: 'object', value: null, optional: true },
  getElevationTo: { type: 'accessor', value: 0 },
  getFillColorTo: { type: 'accessor', value: [0, 0, 0, 255] },
};

export class MorphColumnLayer<DataT = unknown> extends ColumnLayer<
  DataT,
  MorphColumnLayerProps<DataT>
> {
  static override layerName = 'MorphColumnLayer';
  static override defaultProps = {
    ...ColumnLayer.defaultProps,
    ...defaultProps,
  } as never;

  override getShaders(): Record<string, unknown> {
    const shaders = super.getShaders() as {
      vs: string;
      modules: unknown[];
      [key: string]: unknown;
    };
    return {
      ...shaders,
      vs: patchColumnShader(shaders.vs),
      modules: [...shaders.modules, morphUniforms],
    };
  }

  override initializeState(): void {
    super.initializeState();
    this.getAttributeManager()?.addInstanced({
      instanceElevationsTo: {
        size: 1,
        transition: false,
        accessor: 'getElevationTo',
        defaultValue: 0,
      },
      instanceFillColorsTo: {
        size: 4,
        type: 'unorm8',
        transition: false,
        accessor: 'getFillColorTo',
        defaultValue: [0, 0, 0, 255],
      },
    });
  }

  override draw(params: Record<string, unknown>): void {
    const mixAmount = Math.min(1, Math.max(0, this.props.mixAmount ?? 1));
    const box = this.props.fadeBox;
    const morph = box
      ? {
          mixAmount,
          fadeOpacity: Math.min(1, Math.max(0, box.opacity)),
          fadeMin: [box.bounds[0], box.bounds[1]],
          fadeMax: [box.bounds[2], box.bounds[3]],
          fadeMargin: [Math.max(box.margin[0], 1e-6), Math.max(box.margin[1], 1e-6)],
        }
      : { mixAmount, fadeOpacity: 1, fadeMin: [0, 0], fadeMax: [0, 0], fadeMargin: [1, 1] };
    for (const model of [this.state.fillModel, this.state.wireframeModel]) {
      (model as { shaderInputs?: { setProps(p: unknown): void } } | undefined)
        ?.shaderInputs?.setProps({ morph });
    }
    super.draw(params as never);
  }
}
