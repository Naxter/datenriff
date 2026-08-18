// A mode is data, not code: adding one means adding an entry here plus the
// metrics in the dataset. No renderer changes.

import type { SculptureDataset, SculptureMode } from '@datenriff/data-contracts';

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
    label: 'Rent',
    subtitle: 'Housing mass, priced — expensive regions glow',
    dataset: 'zensus',
    heightMetric: 'homes',
    colorMetric: 'rent',
    heightScale: { type: 'linear' },
    colorScale: { type: 'linear', domain: [5, 15], palette: 'rent' },
    tooltip: {
      fields: [
        { metric: 'homes', label: 'Homes', format: 'integer' },
        { metric: 'rent', label: 'Net cold rent', format: 'currencyPerSqm' },
      ],
    },
    attribution: CENSUS_ATTRIBUTION,
  },
  {
    id: 'heating',
    label: 'Heating',
    subtitle: "Germany's heating landscape by energy source",
    dataset: 'zensus',
    heightMetric: 'homes',
    colorMetric: 'heating_category',
    heightScale: { type: 'linear' },
    colorScale: { type: 'categorical', palette: 'heating', saturationMetric: 'heating_dominance' },
    tooltip: {
      fields: [
        { metric: 'homes', label: 'Homes', format: 'integer' },
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
    label: 'Homes',
    subtitle: 'Housing stock, and where it was built recently',
    dataset: 'zensus',
    heightMetric: 'homes',
    colorMetric: 'homes_new_share',
    heightScale: { type: 'linear' },
    // Destatis rounds cell values independently, so a handful of tiny cells
    // report a share slightly above 1; the domain clips them.
    colorScale: { type: 'linear', domain: [0, 0.6], palette: 'vintage' },
    tooltip: {
      fields: [
        { metric: 'homes', label: 'Dwellings', format: 'integer' },
        { metric: 'homes_new_share', label: 'Built 2014 or later', format: 'percent' },
      ],
    },
    attribution: CENSUS_ATTRIBUTION,
  },
  {
    id: 'vacancy',
    label: 'Vacancy',
    subtitle: 'Where flats stand empty',
    dataset: 'zensus',
    heightMetric: 'homes',
    colorMetric: 'vacancy_rate',
    heightScale: { type: 'linear' },
    colorScale: { type: 'linear', domain: [0, 20], palette: 'vacancy' },
    tooltip: {
      fields: [
        { metric: 'homes', label: 'Dwellings', format: 'integer' },
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
    label: 'Families',
    subtitle: 'How many people share a home',
    dataset: 'zensus',
    heightMetric: 'population_2022',
    colorMetric: 'household_size',
    heightScale: { type: 'linear' },
    colorScale: { type: 'linear', domain: [1.5, 3], palette: 'household' },
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
  referenceDate: '2016-01-01',
};

// Proves the renderer is not a census viewer: a satellite raster, a
// different cell universe and its own resolution, same contracts.
MODES.push({
  id: 'afterdark',
  label: 'After Dark',
  // deliberately not "light pollution": the product measures light leaving
  // the ground, not its ecological effect (plan §19)
  subtitle: 'Artificial light over Germany',
  dataset: 'afterdark',
  heightMetric: 'light_brightness',
  colorMetric: 'light_brightness',
  // a dense low field: a steeper, more frontal view keeps the cities from
  // stacking into one wall the way the census poster angle would
  camera: { pitch: 50, bearing: -8 },
  heightScale: { type: 'linear' },
  colorScale: { type: 'sqrt', clip: 0.995, palette: 'afterdark', gamma: 1.35 },
  tooltip: {
    fields: [
      { metric: 'light_brightness', label: 'Brightness', format: 'integer' },
    ],
  },
  attribution: NASA_ATTRIBUTION,
});

export function getMode(id: string): SculptureMode {
  return MODES.find((m) => m.id === id) ?? MODES[0]!;
}

/** Can this dataset serve this mode? CHANGE is derived from two buffers. */
export function datasetServesMode(
  dataset: SculptureDataset,
  mode: SculptureMode,
): boolean {
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
