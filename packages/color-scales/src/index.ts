export {
  PALETTES,
  PAPER,
  MISSING,
  SEQUENTIAL_CHOICES,
  getPalette,
  hexToRgb,
  type RGB,
  type Palette,
  type SequentialPalette,
  type DivergingPalette,
  type CategoricalPalette,
} from './palettes.js';

export {
  interpolateStops,
  resolveSequentialDomain,
  resolveDivergingHalfWidth,
  mapSequential,
  mapDiverging,
  mapCategorical,
  applyColorScale,
  legendGradient,
  type MetricValues,
} from './scales.js';
