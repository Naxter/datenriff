// Warm ambient + warm key + cool fill. One stable effect instance; texture
// layers opt out of the shadow pass with `shadowEnabled: false`.

import { AmbientLight, DirectionalLight, LightingEffect } from '@deck.gl/core';

/** Key light comes from the upper left so shadows fall to the right, like
 *  the reference poster (−x = light on the left in deck's convention).
 *  Only the elevation is a viewer setting; this is the horizontal heading. */
const KEY_HEADING: [number, number] = [-0.646, -0.763];

export const DEFAULT_SHADOW_STRENGTH = 0.22;
/** Steep — ~62°. 100 km needles under a low sun throw shadows across half
 *  the country as smears; steep light keeps them as short pools at each
 *  foot, which is what the reference shows. */
export const DEFAULT_LIGHT_ELEVATION = 62;

/** Direction vector for a key light at `elevationDeg` above the plane. */
export function keyDirection(elevationDeg: number): [number, number, number] {
  const el = (elevationDeg * Math.PI) / 180;
  const h = Math.cos(el);
  return [KEY_HEADING[0] * h, KEY_HEADING[1] * h, -Math.sin(el)];
}

export function createLighting(
  shadows: boolean,
  shadowStrength = DEFAULT_SHADOW_STRENGTH,
  lightElevation = DEFAULT_LIGHT_ELEVATION,
): LightingEffect {
  const effect = new LightingEffect({
    ambient: new AmbientLight({
      color: [255, 250, 242],
      intensity: 1.12,
    }),
    key: new DirectionalLight({
      color: [255, 242, 226],
      intensity: 1.35,
      direction: keyDirection(lightElevation),
      _shadow: shadows,
    }),
    // cool fill from the opposite side lifts the shadowed walls
    fill: new DirectionalLight({
      color: [186, 202, 255],
      intensity: 0.6,
      direction: [4, 2, -1.2],
    }),
  });
  tuneLighting(effect, shadowStrength, lightElevation);
  return effect;
}

/** Adjust strength and angle on the live effect. deck reads the light's
 *  direction and the effect's shadowColor every frame, so mutating them
 *  avoids swapping effect instances (stale shadow bindings in 9.1). */
export function tuneLighting(
  effect: LightingEffect,
  shadowStrength: number,
  lightElevation: number,
): void {
  // warm ink on paper; the plane makes this the visible ground shading
  effect.shadowColor = [0.2, 0.14, 0.09, shadowStrength];
  const lights = (effect as unknown as { directionalLights?: DirectionalLight[] })
    .directionalLights;
  const key = lights?.[0];
  if (key) key.direction = keyDirection(lightElevation);
}
