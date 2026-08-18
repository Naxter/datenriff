// GPU morph between two sculptures (plan §69).
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

const MORPH_UNIFORMS = `\
uniform morphUniforms {
  float mixAmount;
} morph;
`;

const morphUniforms = {
  name: 'morph' as const,
  vs: MORPH_UNIFORMS,
  uniformTypes: { mixAmount: 'f32' },
};

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
  getElevationTo?: Accessor<DataT, number>;
  getFillColorTo?: Accessor<DataT, [number, number, number, number]>;
}

const defaultProps: DefaultProps<MorphColumnLayerProps> = {
  mixAmount: { type: 'number', value: 1, min: 0, max: 1 },
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
    for (const model of [this.state.fillModel, this.state.wireframeModel]) {
      (model as { shaderInputs?: { setProps(p: unknown): void } } | undefined)
        ?.shaderInputs?.setProps({ morph: { mixAmount } });
    }
    super.draw(params as never);
  }
}
