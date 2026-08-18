// Palettes are designed against the warm paper background #F7F0EA: light
// ends sit close to the paper, saturated ends carry the signal.

export type RGB = readonly [number, number, number];

export interface SequentialPalette {
  kind: 'sequential';
  stops: RGB[];
}

export interface DivergingPalette {
  kind: 'diverging';
  /** Odd stop count; the middle stop is the neutral. */
  stops: RGB[];
}

export interface CategoricalPalette {
  kind: 'categorical';
  colors: RGB[];
  /** Mixed-in colour for cells with low dominance. */
  neutral: RGB;
}

export type Palette = SequentialPalette | DivergingPalette | CategoricalPalette;

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ] as const;
}

const seq = (...hex: string[]): SequentialPalette => ({
  kind: 'sequential',
  stops: hex.map(hexToRgb),
});

const div = (...hex: string[]): DivergingPalette => ({
  kind: 'diverging',
  stops: hex.map(hexToRgb),
});

export const PAPER: RGB = hexToRgb('#F7F0EA');

/** Colour for suppressed / missing cells. */
export const MISSING: RGB = hexToRgb('#DDD5CB');

export const PALETTES: Record<string, Palette> = {
  // quantities
  population: seq('#ECE7F6', '#C9B6E9', '#A280D8', '#8F5FBF', '#B2519F', '#C41E78'),
  glacier: seq('#EBF0F4', '#C3D4E2', '#8FB0CE', '#5E7FB3', '#3D5490', '#22336B'),
  ember: seq('#F5EDE0', '#EFD08A', '#E8A24C', '#D66233', '#A82E2C', '#6E1420'),
  noir: seq('#EEE8E0', '#CFC8BE', '#A39B8F', '#6F675C', '#403A32', '#191511'),
  // paper → moss → deep forest green
  moss: seq('#EDF0E6', '#C6DBBC', '#8FBF92', '#4F9C69', '#23704C', '#0F4A34'),
  rain: seq('#EAE8F2', '#A9B6E3', '#7D7ED1', '#8A5BB8', '#C0509B'),
  // dark-canvas ramp for nighttime radiance
  afterdark: seq('#16111E', '#3A2E55', '#7A5390', '#C7788D', '#F0B45F', '#FBE9C0'),

  // properties
  change: div('#1F3F7A', '#9AA8DE', '#F2EBE0', '#F0A0BF', '#B81D74'),
  // empty flats: pale where lived-in, rust where standing empty
  vacancy: seq('#EFEAE1', '#DCC9A8', '#C99A6B', '#B06542', '#7E3220'),
  // building age: old stock cool and quiet, new build bright
  vintage: seq('#3C4A5C', '#7A8B9C', '#C3C7C2', '#E4C98A', '#F2E3B8'),
  // household size: singles pale, large households deep green
  household: seq('#F2EEE4', '#CBD8C2', '#94B58F', '#557F5F', '#2A4A3C'),
  age: seq('#2F8A7D', '#9EC6B6', '#F2EBDF', '#C98FA8', '#77365C'),
  rent: seq('#F2EBDF', '#EFC968', '#E89A3C', '#D95F3B', '#A8232F'),

  // 0 gas · 1 oil · 2 district · 3 heat pump · 4 electric · 5 biomass · 6 other
  heating: {
    kind: 'categorical',
    colors: [
      hexToRgb('#E0A32E'),
      hexToRgb('#C4523A'),
      hexToRgb('#8A63C9'),
      hexToRgb('#2FA8BC'),
      hexToRgb('#9FB8D8'),
      hexToRgb('#6FA45E'),
      hexToRgb('#B9B2A6'),
    ],
    neutral: hexToRgb('#E4DDD2'),
  },

  // solar · wind · biomass · hydro · storage
  energy: {
    kind: 'categorical',
    colors: [
      hexToRgb('#E8B62B'),
      hexToRgb('#2FA8BC'),
      hexToRgb('#6FA45E'),
      hexToRgb('#3E6FB8'),
      hexToRgb('#8A63C9'),
    ],
    neutral: hexToRgb('#E4DDD2'),
  },
};

/** Ramps the user may pick as an override for sequential modes. */
export const SEQUENTIAL_CHOICES = ['population', 'glacier', 'moss', 'ember', 'noir', 'age', 'rent'];

export function getPalette(id: string): Palette {
  const p = PALETTES[id];
  if (!p) throw new Error(`Unknown palette: ${id}`);
  return p;
}
