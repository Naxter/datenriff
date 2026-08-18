// A mode is data, not code: adding one means adding an entry here plus the
// metrics in the dataset. No renderer changes.

import type { SculptureMode } from '@datenriff/data-contracts';

const DEMO_ATTRIBUTION = {
  label: 'Demo: synthetische Daten — Zensus-Pipeline siehe pipelines/zensus',
  referenceDate: '2022-05-15',
};

/** Derived in the app from the two population buffers, not shipped. */
export const CHANGE_PCT_METRIC = 'population_change_pct';

export const MODES: SculptureMode[] = [
  {
    id: 'people',
    label: 'People',
    subtitle: "Germany's population landscape",
    dataset: 'zensus_demo',
    heightMetric: 'population_2022',
    colorMetric: 'population_2022',
    heightScale: { type: 'linear' },
    colorScale: { type: 'sqrt', clip: 0.995, palette: 'population', gamma: 1.5 },
    tooltip: {
      fields: [{ metric: 'population_2022', label: 'Population', format: 'integer' }],
    },
    attribution: DEMO_ATTRIBUTION,
  },
  {
    id: 'change',
    label: 'Change',
    subtitle: 'How the human topography shifted, 2011 → 2022',
    dataset: 'zensus_demo',
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
    attribution: DEMO_ATTRIBUTION,
  },
  {
    id: 'age',
    label: 'Age',
    subtitle: 'Where Germany is young, and where it is old',
    dataset: 'zensus_demo',
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
    attribution: DEMO_ATTRIBUTION,
  },
  {
    id: 'rent',
    label: 'Rent',
    subtitle: 'Housing mass, priced — expensive regions glow',
    dataset: 'zensus_demo',
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
    attribution: DEMO_ATTRIBUTION,
  },
  {
    id: 'heating',
    label: 'Heating',
    subtitle: "Germany's heating landscape by energy source",
    dataset: 'zensus_demo',
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
    attribution: DEMO_ATTRIBUTION,
  },
];

export function getMode(id: string): SculptureMode {
  return MODES.find((m) => m.id === id) ?? MODES[0]!;
}
