// Warm ambient + warm key + cool fill. Shadows only run while the camera
// is idle; the caller rebuilds the effect when interaction starts/stops.

import { AmbientLight, DirectionalLight, LightingEffect } from '@deck.gl/core';

export function createLighting(shadows: boolean): LightingEffect {
  const effect = new LightingEffect({
    ambient: new AmbientLight({
      color: [255, 250, 242],
      intensity: 1.12,
    }),
    key: new DirectionalLight({
      color: [255, 242, 226],
      intensity: 1.35,
      direction: [-3, -5, -4.2],
      _shadow: shadows,
    }),
    fill: new DirectionalLight({
      color: [186, 202, 255],
      intensity: 0.6,
      direction: [4, 2, -1.2],
    }),
  });
  effect.shadowColor = [0.16, 0.12, 0.09, 0.2];
  return effect;
}
