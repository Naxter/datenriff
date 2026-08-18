// Warm ambient + warm key + cool fill. One stable effect instance; texture
// layers opt out of the shadow pass with `shadowEnabled: false`.

import { AmbientLight, DirectionalLight, LightingEffect } from '@deck.gl/core';

export function createLighting(shadows: boolean): LightingEffect {
  const effect = new LightingEffect({
    ambient: new AmbientLight({
      color: [255, 250, 242],
      intensity: 1.12,
    }),
    // Key light from the upper left so shadows fall to the right, like the
    // reference poster (−x = light on the left in deck's convention).
    // Steep — ~62° elevation. 100 km needles at a low sun throw shadows
    // across half the country as smears; steep light keeps them as short
    // pools at each foot, which is what the reference shows.
    key: new DirectionalLight({
      color: [255, 242, 226],
      intensity: 1.35,
      direction: [-2.2, -2.6, -6.4],
      _shadow: shadows,
    }),
    // cool fill from the opposite side lifts the shadowed walls
    fill: new DirectionalLight({
      color: [186, 202, 255],
      intensity: 0.6,
      direction: [4, 2, -1.2],
    }),
  });
  // warm ink on paper; the plane makes this the visible ground shading
  effect.shadowColor = [0.2, 0.14, 0.09, 0.22];
  return effect;
}
