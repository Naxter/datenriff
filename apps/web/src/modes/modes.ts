// A mode is data, not code: adding one means adding an entry here plus the
// metrics in the dataset. No renderer changes.

import type { ModeFamily, SculptureDataset, SculptureMode } from '@datenriff/data-contracts';

const CENSUS_ATTRIBUTION = {
  label: 'Data: Destatis, Zensus 2022',
  url: 'https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Zensus2022/_inhalt.html',
  referenceDate: '2022-05-15',
};

/** Derived in the app from the two population buffers, not shipped. */
export const CHANGE_PCT_METRIC = 'population_change_pct';

/** Curated camera moves (plan §98). Zoom is absolute Mercator scale, so
 *  these are city-scale stops the viewer flies between. */
const RUHR = { longitude: 7.1, latitude: 51.45, zoom: 8.4 };
const BERLIN = { longitude: 13.4, latitude: 52.52, zoom: 8.6 };
const MUNICH = { longitude: 11.57, latitude: 48.14, zoom: 8.6 };
const LEIPZIG = { longitude: 12.37, latitude: 51.34, zoom: 8.6 };
const LAUSITZ = { longitude: 14.3, latitude: 51.55, zoom: 8.0 };
const RHINE_MAIN = { longitude: 8.68, latitude: 50.11, zoom: 8.4 };

export const MODES: SculptureMode[] = [
  {
    id: 'people',
    family: 'population',
    label: 'People',
    subtitle: "Germany's population landscape",
    dataset: 'zensus',
    heightMetric: 'population_2022',
    colorMetric: 'population_2022',
    heightScale: { type: 'linear' },
    colorScale: { type: 'sqrt', clip: 0.995, palette: 'population', gamma: 2.0 },
    tooltip: {
      fields: [{ metric: 'population_2022', label: 'Population', format: 'integer' }],
    },
    stories: [
      {
        id: 'metropolises',
        label: 'The big four',
        stops: [
          { label: 'Rhine-Ruhr', ...RUHR },
          { label: 'Berlin', ...BERLIN },
          { label: 'Rhine-Main', ...RHINE_MAIN },
          { label: 'Munich', ...MUNICH },
        ],
      },
    ],
    attribution: CENSUS_ATTRIBUTION,
  },
  {
    id: 'change',
    family: 'population',
    label: 'Change',
    subtitle: 'How the human topography shifted, 2011 → 2022',
    dataset: 'zensus',
    heightMetric: 'population_2022',
    colorMetric: CHANGE_PCT_METRIC,
    heightScale: { type: 'linear' },
    colorScale: { type: 'diverging', center: 0, halfWidth: 0.3, palette: 'change' },
    time: { kind: 'steps', steps: ['2011', '2022'], metricTemplate: 'population_{step}' },
    tooltip: {
      fields: [
        { metric: 'population_2022', label: 'Population 2022', format: 'integer' },
        { metric: CHANGE_PCT_METRIC, label: 'Change 2011–2022', format: 'percent' },
      ],
    },
    stories: [
      {
        id: 'growth-and-shrinking',
        label: 'Growth and shrinking',
        stops: [
          { label: 'Munich, growing', ...MUNICH },
          { label: 'Leipzig, turned around', ...LEIPZIG },
          { label: 'Lusatia, shrinking', ...LAUSITZ },
        ],
      },
    ],
    attribution: CENSUS_ATTRIBUTION,
  },
  {
    id: 'age',
    family: 'population',
    label: 'Age',
    subtitle: 'Where Germany is young, and where it is old',
    dataset: 'zensus',
    heightMetric: 'population_2022',
    colorMetric: 'age_mean',
    heightScale: { type: 'linear' },
    colorScale: { type: 'linear', domain: [40, 52], palette: 'age' },
    tooltip: {
      fields: [
        { metric: 'population_2022', label: 'Population', format: 'integer' },
        { metric: 'age_mean', label: 'Average age', format: 'decimal1' },
      ],
    },
    attribution: CENSUS_ATTRIBUTION,
  },
  {
    id: 'rent',
    family: 'housing',
    label: 'Rent',
    subtitle: 'Housing mass, priced — expensive regions glow',
    dataset: 'zensus',
    heightMetric: 'homes',
    colorMetric: 'rent',
    heightScale: { type: 'linear' },
    // No cell reaches 15 €/m² — p98 is 9.80 — so the old ceiling spent a
    // third of the ramp on rents that do not exist while a quarter of the
    // country sat clipped at the floor. 4-11 clips 7.7 % and 0.8 %.
    colorScale: { type: 'linear', domain: [4, 11], palette: 'rent' },
    tooltip: {
      fields: [
        { metric: 'homes', label: 'Rented dwellings', format: 'integer' },
        { metric: 'rent', label: 'Net cold rent', format: 'currencyPerSqm' },
      ],
    },
    attribution: CENSUS_ATTRIBUTION,
  },
  {
    id: 'heating',
    family: 'housing',
    label: 'Heating',
    subtitle: "Germany's heating landscape by energy source",
    dataset: 'zensus',
    // the carrier is reported for every dwelling, so the height has to be
    // every dwelling too: on the rented count, 44 % of cells with a heating
    // category stood at zero and seven million dwellings were invisible
    heightMetric: 'homes_total',
    colorMetric: 'heating_category',
    heightScale: { type: 'linear' },
    colorScale: { type: 'categorical', palette: 'heating', saturationMetric: 'heating_dominance' },
    tooltip: {
      fields: [
        { metric: 'homes_total', label: 'Dwellings', format: 'integer' },
        { metric: 'heating_category', label: 'Dominant source', format: 'category' },
      ],
    },
    attribution: CENSUS_ATTRIBUTION,
  },
];

// V1.1 modes — same renderer, new census metrics only.
MODES.push(
  {
    id: 'homes',
    family: 'housing',
    label: 'Homes',
    subtitle: 'Housing stock, and where it was built recently',
    dataset: 'zensus',
    heightMetric: 'homes_total',
    colorMetric: 'homes_new_share',
    heightScale: { type: 'linear' },
    // Nationally 5 % of homes are this new, and p95 of a cell is 0.22, so the
    // ramp ends at 0.3 — about 3 % of cells clip. Destatis also rounds cell
    // values independently, which leaves a few tiny cells above 1.
    colorScale: { type: 'linear', domain: [0, 0.3], palette: 'vintage' },
    tooltip: {
      fields: [
        { metric: 'homes_total', label: 'Dwellings', format: 'integer' },
        { metric: 'homes_new_share', label: 'Built 2014 or later', format: 'percent' },
      ],
    },
    attribution: CENSUS_ATTRIBUTION,
  },
  {
    id: 'vacancy',
    family: 'housing',
    label: 'Vacancy',
    subtitle: 'Where flats stand empty',
    dataset: 'zensus',
    heightMetric: 'homes_total',
    colorMetric: 'vacancy_rate',
    heightScale: { type: 'linear' },
    colorScale: { type: 'linear', domain: [0, 20], palette: 'vacancy' },
    tooltip: {
      fields: [
        { metric: 'homes_total', label: 'Dwellings', format: 'integer' },
        { metric: 'vacancy_rate', label: 'Vacancy rate', format: 'decimal1' },
      ],
    },
    stories: [
      {
        id: 'empty-east',
        label: 'Empty corners',
        stops: [
          { label: 'Lusatia', ...LAUSITZ },
          { label: 'Leipzig', ...LEIPZIG },
          { label: 'Munich, full', ...MUNICH },
        ],
      },
    ],
    attribution: CENSUS_ATTRIBUTION,
  },
  {
    id: 'families',
    family: 'population',
    label: 'Families',
    subtitle: 'How many people share a home',
    dataset: 'zensus',
    heightMetric: 'population_2022',
    colorMetric: 'household_size',
    heightScale: { type: 'linear' },
    // 1 is the floor a household can have, and 7 % of cells sit under 1.5:
    // city centres full of one-person households, the part worth seeing
    colorScale: { type: 'linear', domain: [1, 3.5], palette: 'household' },
    tooltip: {
      fields: [
        { metric: 'population_2022', label: 'Population', format: 'integer' },
        { metric: 'household_size', label: 'Household size', format: 'decimal1' },
      ],
    },
    attribution: CENSUS_ATTRIBUTION,
  },
);

const NASA_ATTRIBUTION = {
  label: 'Data: NASA Black Marble',
  url: 'https://www.earthdata.nasa.gov/data/projects/black-marble',
};

/** VNP46A4 annual composites exist from 2012, one per finished year; the
 *  mode is bound to the years the dataset actually carries (see `bindMode`),
 *  so the spare years cost nothing until they are published. */
const BLACK_MARBLE_YEARS = Array.from({ length: 19 }, (_, i) => String(2012 + i));

// Proves the renderer is not a census viewer: a satellite raster, a
// different cell universe and its own resolution, same contracts.
MODES.push({
  id: 'afterdark',
  family: 'energy',
  label: 'After Dark',
  // deliberately not "light pollution": the product measures light leaving
  // the ground, not its ecological effect (plan §19)
  subtitle: 'Artificial light over Germany',
  dataset: 'afterdark',
  // the latest year the data carries stands in for these (bindMode)
  heightMetric: 'light_2024',
  colorMetric: 'light_2024',
  time: { kind: 'steps', steps: BLACK_MARBLE_YEARS, metricTemplate: 'light_{step}' },
  // a dense low field: a steeper, more frontal view keeps the cities from
  // stacking into one wall the way the census poster angle would
  camera: { pitch: 50, bearing: -8 },
  heightScale: { type: 'linear' },
  colorScale: { type: 'sqrt', clip: 0.995, palette: 'afterdark', gamma: 1.35 },
  tooltip: {
    fields: [{ metric: 'light_2024', label: 'Night light', format: 'decimal1' }],
  },
  attribution: NASA_ATTRIBUTION,
});

const MASTR_ATTRIBUTION = {
  label: 'Data: Bundesnetzagentur, Marktstammdatenregister',
  url: 'https://www.marktstammdatenregister.de/MaStR/Datendownload',
};

/** Wind power has been registered since the first turbines of the 1990s;
 *  the mode is bound to the years the dataset carries. */
const WIND_YEARS = Array.from({ length: 41 }, (_, i) => String(1990 + i));

// The energy transition as a landscape (plan §26): every turbine standing
// at year end, cumulative MW per cell, played year by year. Offshore parks
// stay in — they are the North Sea's story.
MODES.push({
  id: 'wind',
  family: 'energy',
  label: 'Wind',
  subtitle: 'Wind power, built up year by year since 1990',
  dataset: 'energy',
  heightMetric: 'wind_mw_2030',
  colorMetric: 'wind_mw_2030',
  time: { kind: 'steps', steps: WIND_YEARS, metricTemplate: 'wind_mw_{step}' },
  heightScale: { type: 'linear' },
  colorScale: { type: 'sqrt', clip: 0.995, palette: 'wind', gamma: 1.2 },
  tooltip: {
    fields: [{ metric: 'wind_mw_2030', label: 'Installed wind power', format: 'megawatt' }],
  },
  attribution: MASTR_ATTRIBUTION,
});

const DWD_ATTRIBUTION = {
  label: 'Data: Deutscher Wetterdienst',
  url: 'https://opendata.dwd.de/climate_environment/CDC/grids_germany/annual/precipitation/',
};

/** DWD's annual grids reach back to 1881; the mode binds to what the
 *  dataset actually carries. */
const RAIN_YEARS = Array.from({ length: 60 }, (_, i) => String(1971 + i));

// Rainfall is a field, not a scatter of peaks: a raised sheet with ridges
// over the Alps, the Black Forest and the Harz, and a dip in the dry belt
// around Magdeburg. `zeroAt` puts the driest square kilometre near the
// plane instead of 300 mm above it, so that relief stays readable.
MODES.push({
  id: 'rain',
  family: 'nature',
  label: 'Rain',
  subtitle: 'A year of rainfall, from the dry east to the Alps',
  dataset: 'rain',
  heightMetric: 'rain_mm_2030',
  colorMetric: 'rain_mm_2030',
  time: { kind: 'steps', steps: RAIN_YEARS, metricTemplate: 'rain_mm_{step}' },
  heightScale: { type: 'linear', zeroAt: 300 },
  // One domain has to hold a dry year and a wet one, since a fixed scale is
  // what makes the scrub show real change. Dropping the floor to 400 rescues
  // a fifth of 2025 (20.9 % clipped, now 1.2 %) and costs 2001 under a point.
  colorScale: { type: 'linear', domain: [400, 1500], palette: 'rain' },
  tooltip: {
    fields: [{ metric: 'rain_mm_2030', label: 'Annual precipitation', format: 'millimetre' }],
  },
  attribution: DWD_ATTRIBUTION,
});

const BKG_ATTRIBUTION = {
  label: 'Data: GeoBasis-DE / BKG, CLC5',
  url: 'https://gdz.bkg.bund.de/index.php/default/corine-land-cover-5-ha-clc5.html',
};

/** CLC5 has four vintages; the mode binds to the ones actually loaded. */
const CLC5_VINTAGES = ['2012', '2015', '2018', '2021'];

// What the country is made of. Height is the artificial share of a cell,
// colour the land cover that covers most of it — so cities rise as plateaus
// out of a field that is green where it grows and blue where it is water.
// Scrubbing the timeline moves both: the built share grows and the land
// cover of that vintage comes with it.
MODES.push({
  id: 'land',
  family: 'nature',
  label: 'Land',
  subtitle: 'What the ground is made of, and how much of it is built',
  dataset: 'land',
  heightMetric: 'built_share_2021',
  colorMetric: 'land_class_2021',
  // a dense field, like AFTER DARK: a steeper, more frontal view keeps the
  // cities from stacking into one wall
  camera: { pitch: 48, bearing: -8 },
  // the share is bounded at 1 and a city's cells all sit near it, so the
  // full 100 km ceiling would stand the Ruhr up as a palisade
  time: {
    kind: 'steps',
    steps: CLC5_VINTAGES,
    metricTemplate: 'built_share_{step}',
    // the cover is mapped per vintage too, so scrubbing shows the ground
    // changing rather than 2021's cover under a moving built share
    colorMetricTemplate: 'land_class_{step}',
    saturationMetricTemplate: 'land_class_dominance_{step}',
  },
  heightScale: { type: 'linear', maxMeters: 26_000 },
  colorScale: {
    type: 'categorical',
    palette: 'land',
    saturationMetric: 'land_class_dominance_2021',
  },
  tooltip: {
    fields: [
      { metric: 'built_share_2021', label: 'Artificial surface', format: 'percent' },
      { metric: 'land_class_2021', label: 'Dominant cover', format: 'category' },
    ],
  },
  attribution: BKG_ATTRIBUTION,
});

const EFDA_ATTRIBUTION = {
  label: 'Data: European Forest Disturbance Atlas',
  url: 'https://zenodo.org/records/13333034',
  referenceDate: '2023-12-31',
};

// Where the forest stands, and how much of it has come down. Height is the
// share of the cell under canopy, so the map is the forest itself — the
// Harz, the Bavarian Forest, the Black Forest as ridges. Colour is the part
// of that canopy disturbed at least once since 1985, which is why the
// bark-beetle years show as a stain across the middle of the country.
MODES.push({
  id: 'forest',
  family: 'nature',
  label: 'Forest',
  subtitle: 'Where the forest stands, and how much of it was disturbed since 1985',
  dataset: 'forest',
  heightMetric: 'forest_share',
  colorMetric: 'disturbed_share',
  // a dense, low field like LAND: a frontal camera keeps the ridges apart
  camera: { pitch: 48, bearing: -8 },
  // another share bounded at 1, so it needs its own ceiling or the wooded
  // uplands stand up as one wall
  heightScale: { type: 'linear', maxMeters: 22_000 },
  // p90 of a cell is 0.34 and p99 is 0.64; ending at half keeps the
  // beetle-struck uplands legible without pinning ordinary forestry there
  colorScale: { type: 'linear', domain: [0, 0.5], palette: 'forest' },
  tooltip: {
    fields: [
      { metric: 'forest_share', label: 'Forest cover', format: 'percent' },
      { metric: 'disturbed_share', label: 'Disturbed since 1985', format: 'percent' },
      { metric: 'disturbance_agent', label: 'Main cause', format: 'category' },
    ],
  },
  attribution: EFDA_ATTRIBUTION,
});

const boundModes = new Map<string, SculptureMode>();

/** A mode adapted to what a dataset actually carries: time steps whose
 *  metric is missing are dropped, and metrics that follow the step template
 *  (height, colour, tooltip) point at the latest step present. So the same
 *  AFTER DARK mode runs on one demo year or on the full 2012–2024 series,
 *  and CHANGE is untouched (its 2011 and 2022 are both there). With fewer
 *  than two steps left the timeline goes away. */
export function bindMode(mode: SculptureMode, dataset: SculptureDataset): SculptureMode {
  if (!mode.time) return mode;
  const key = `${mode.id}|${dataset.id}|${dataset.metrics.map((m) => m.id).join(',')}`;
  const cached = boundModes.get(key);
  if (cached) return cached;
  const templates = [
    mode.time.metricTemplate,
    mode.time.colorMetricTemplate,
    mode.time.saturationMetricTemplate,
  ].filter((t): t is string => Boolean(t));
  const fill = (t: string, step: string) => t.replace('{step}', step);
  const template = (step: string) => fill(mode.time!.metricTemplate, step);
  const has = (id: string) => dataset.metrics.some((m) => m.id === id);
  // a step counts only if every series it drives is actually present
  const steps = mode.time.steps.filter((s) => templates.every((t) => has(fill(t, s))));
  let bound = mode;
  if (steps.length > 0 && steps.length !== mode.time.steps.length) {
    const lastStep = steps[steps.length - 1]!;
    const sub = (id: string) => {
      const t = templates.find((tpl) => mode.time!.steps.some((s) => fill(tpl, s) === id));
      return t ? fill(t, lastStep) : id;
    };
    bound = {
      ...mode,
      heightMetric: sub(mode.heightMetric),
      colorMetric: sub(mode.colorMetric),
      tooltip: {
        ...mode.tooltip,
        fields: mode.tooltip.fields.map((f) => ({ ...f, metric: sub(f.metric) })),
      },
    };
    if (steps.length >= 2) bound.time = { ...mode.time, steps };
    else delete bound.time;
  }
  boundModes.set(key, bound);
  return bound;
}

/** A mode by id; with a dataset, bound to the metrics that dataset carries. */
export function getMode(id: string, dataset?: SculptureDataset): SculptureMode {
  const mode = MODES.find((m) => m.id === id) ?? MODES[0]!;
  return dataset ? bindMode(mode, dataset) : mode;
}

/** Can this dataset serve this mode? CHANGE is derived from two buffers. */
export function datasetServesMode(
  dataset: SculptureDataset,
  unbound: SculptureMode,
): boolean {
  const mode = bindMode(unbound, dataset);
  const has = (id: string) => dataset.metrics.some((m) => m.id === id);
  if (!has(mode.heightMetric)) return false;
  if (mode.colorMetric === CHANGE_PCT_METRIC) {
    return has('population_2022') && has('population_2011');
  }
  if (!has(mode.colorMetric)) return false;
  const scale = mode.colorScale;
  if (scale.type === 'categorical' && scale.saturationMetric) {
    return has(scale.saturationMetric);
  }
  return true;
}

/** Modes any loaded dataset can serve. */
export function availableModes(datasets: SculptureDataset[]): SculptureMode[] {
  return MODES.filter((mode) => datasets.some((d) => datasetServesMode(d, mode)));
}

/** Family labels in navigation order. A family with no available mode is
 *  never shown, so a clone with only census data sees two of them. */
export const FAMILIES: { id: ModeFamily; label: string }[] = [
  { id: 'population', label: 'Population' },
  { id: 'housing', label: 'Housing' },
  { id: 'nature', label: 'Nature' },
  { id: 'energy', label: 'Energy' },
];

/** Available modes grouped into families, empty families dropped. */
export function modeFamilies(
  modes: SculptureMode[],
): { id: ModeFamily; label: string; modes: SculptureMode[] }[] {
  return FAMILIES.map((family) => ({
    ...family,
    modes: modes.filter((mode) => (mode.family ?? 'population') === family.id),
  })).filter((family) => family.modes.length > 0);
}
