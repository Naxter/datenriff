// Tapers ColumnLayer columns towards their tip.
//
// A field of full-width prisms reads as a carpet; needles let the paper
// through between them and catch light on the tips, which is what the
// editorial reference does. deck.gl has no taper prop, so this hooks
// DECKGL_FILTER_SIZE(inout vec3 size, VertexGeometry geometry), where `size`
// is the horizontal offset in common space. `positions` is the column's
// vertex attribute: z is −1 at the base and +1 at the tip.
//
// Calibrated in the prototype (`?taper=`), mirrored here.

import { LayerExtension, type Layer } from '@deck.gl/core';

export interface NeedleExtensionOptions {
  /** Tip width as a fraction of the base: 1 = prism, 0 = point. */
  taper: number;
}

export class NeedleExtension extends LayerExtension<NeedleExtensionOptions> {
  static override extensionName = 'NeedleExtension';

  constructor(opts: NeedleExtensionOptions = { taper: 1 }) {
    super(opts);
  }

  override getShaders(this: Layer, extension: this): unknown {
    const taper = extension.opts.taper.toFixed(4);
    return {
      inject: {
        // The filter hooks are emitted as functions above main, where the
        // `positions` attribute is not declared yet — so read it at the top
        // of main and hand the result over in a global.
        'vs:#decl': 'float needle_widthScale;\n',
        'vs:#main-start': `
  needle_widthScale = mix(1.0, ${taper}, (positions.z + 1.0) * 0.5);
`,
        'vs:DECKGL_FILTER_SIZE': `
  size.xy *= needle_widthScale;
`,
      },
    };
  }

  override equals(extension: NeedleExtension): boolean {
    return this.opts.taper === extension.opts.taper;
  }
}
