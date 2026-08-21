// Two languages: the atlas is about Germany, and half its sources publish
// in German. English stays the default so the repo reads the same way it
// is written; German is what a visitor here most likely wants.
//
// Keys are dotted and stable; the English text is also the fallback, so a
// missing German string degrades to English rather than to a key.

export type Lang = 'en' | 'de';

export const LANGS: Lang[] = ['en', 'de'];

/** BCP-47 tag for Intl. Numbers were already formatted German — with a
 *  language switch that is now a choice rather than an accident. */
export const LOCALE: Record<Lang, string> = { en: 'en-GB', de: 'de-DE' };

type Dict = Record<string, string>;

const EN: Dict = {
  'ui.export': 'Export',
  'ui.focus': 'Focus',
  'ui.settings': 'Settings',
  'ui.close': 'Close',
  'pages.about': 'About',
  'pages.imprint': 'Legal notice',
  'pages.privacy': 'Privacy',
  'pages.aria': 'About and legal pages',
  'pages.readAsPage': 'Read this as a page →',
  'ui.language': 'Language',
  'ui.modes': 'Sculpture modes',
  'ui.rememberedHere': 'Remembered in this browser',
  'ui.loading': 'Loading …',
  'ui.renderingPreview': 'Rendering preview …',

  'focus.title': 'Focus a state or city (F)',
  'focus.placeholder': 'State or city …',
  'focus.search': 'Search states and cities',
  'focus.states': 'States',
  'focus.cities': 'Cities',
  'focus.whole': 'Whole country',

  'export.title': 'Poster PNG (E)',
  'export.format': 'Poster format',
  'export.quality': 'Quality',
  'export.kind': 'Output',
  'export.image': 'Image',
  'export.animation': 'Animation',
  'export.save': 'Save',
  'export.rendering': 'Rendering …',

  'settings.title': 'Settings',
  'settings.shadows': 'Shadows',
  'settings.shadowStrength': 'Shadow strength',
  'settings.lightElevation': 'Light elevation',
  'settings.quality': 'Quality',
  'settings.labels': 'City labels',
  'settings.motion': 'Motion',
  'settings.border': 'Country outline',
  'settings.borderColor': 'Outline colour',
  'settings.auto': 'Auto',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.desktop': 'Desktop',
  'settings.mobile': 'Mobile',
  'settings.major': 'Major',
  'settings.all': 'All',
  'settings.none': 'None',
  'settings.full': 'Full',
  'settings.reduced': 'Reduced',

  'family.population': 'Population',
  'family.housing': 'Housing',
  'family.nature': 'Nature',
  'family.energy': 'Energy',

  'source.modified': 'data aggregated',
  'source.boundaries': 'Boundaries',
  'ladder.label': 'Detail level',
  'ladder.country': 'Country',
  'ladder.region': 'Region',
  'ladder.city': 'City',
  'ladder.sharpening': 'sharpening',
  'legend.colourRamp': 'Colour ramp',
  'legend.height': 'Height',
  'legend.colour': 'Colour',
  'source.prefix': 'Data:',
  'legend.populationChange': 'Population change',

  'intro.title': 'Datenriff',
  'intro.sub': 'Vertical Atlas — Germany',
};

const DE: Dict = {
  'ui.export': 'Export',
  'ui.focus': 'Fokus',
  'ui.settings': 'Einstellungen',
  'ui.close': 'Schließen',
  'pages.about': 'Über',
  'pages.imprint': 'Impressum',
  'pages.privacy': 'Datenschutz',
  'pages.aria': 'Über diese Seite und rechtliche Hinweise',
  'pages.readAsPage': 'Als Seite lesen →',
  'ui.language': 'Sprache',
  'ui.modes': 'Ansichten',
  'ui.rememberedHere': 'In diesem Browser gespeichert',
  'ui.loading': 'Lädt …',
  'ui.renderingPreview': 'Vorschau wird erzeugt …',

  'focus.title': 'Auf ein Land oder eine Stadt zoomen (F)',
  'focus.placeholder': 'Land oder Stadt …',
  'focus.search': 'Bundesländer und Städte suchen',
  'focus.states': 'Bundesländer',
  'focus.cities': 'Städte',
  'focus.whole': 'Ganz Deutschland',

  'export.title': 'Poster als PNG (E)',
  'export.format': 'Posterformat',
  'export.quality': 'Qualität',
  'export.kind': 'Ausgabe',
  'export.image': 'Bild',
  'export.animation': 'Animation',
  'export.save': 'Speichern',
  'export.rendering': 'Wird gerendert …',

  'settings.title': 'Einstellungen',
  'settings.shadows': 'Schatten',
  'settings.shadowStrength': 'Schattenstärke',
  'settings.lightElevation': 'Lichtwinkel',
  'settings.quality': 'Qualität',
  'settings.labels': 'Städtenamen',
  'settings.motion': 'Bewegung',
  'settings.border': 'Landesumriss',
  'settings.borderColor': 'Umrissfarbe',
  'settings.auto': 'Automatisch',
  'settings.on': 'An',
  'settings.off': 'Aus',
  'settings.desktop': 'Desktop',
  'settings.mobile': 'Mobil',
  'settings.major': 'Große',
  'settings.all': 'Alle',
  'settings.none': 'Keine',
  'settings.full': 'Voll',
  'settings.reduced': 'Reduziert',

  'family.population': 'Bevölkerung',
  'family.housing': 'Wohnen',
  'family.nature': 'Natur',
  'family.energy': 'Energie',

  'source.modified': 'Daten verändert',
  'source.boundaries': 'Grenzen',
  'ladder.label': 'Detailstufe',
  'ladder.country': 'Land',
  'ladder.region': 'Region',
  'ladder.city': 'Stadt',
  'ladder.sharpening': 'wird schärfer',
  'legend.colourRamp': 'Farbskala',
  'legend.height': 'Höhe',
  'legend.colour': 'Farbe',
  'source.prefix': 'Daten:',
  'legend.populationChange': 'Bevölkerungsveränderung',

  'intro.title': 'Datenriff',
  // the wordmark is the brand and reads the same in both languages
  'intro.sub': 'Vertical Atlas — Germany',
};

/** Mode label and subtitle per language, keyed by mode id. */
const MODE_TEXT: Record<Lang, Record<string, { label: string; subtitle: string }>> = {
  en: {},
  de: {
    people: { label: 'Menschen', subtitle: 'Wo Deutschland wohnt' },
    change: {
      label: 'Wandel',
      subtitle: 'Wie sich die menschliche Landschaft verschob, 2011 → 2022',
    },
    age: { label: 'Alter', subtitle: 'Wo das Land jung und wo es alt ist' },
    rent: { label: 'Miete', subtitle: 'Wohnmasse, bepreist — teure Regionen glühen' },
    heating: { label: 'Heizung', subtitle: 'Womit Deutschland heizt' },
    homes: { label: 'Neubau', subtitle: 'Wohnungsbestand, und wo neu gebaut wurde' },
    vacancy: { label: 'Leerstand', subtitle: 'Wo Wohnungen leer stehen' },
    families: { label: 'Haushalte', subtitle: 'Wie viele Menschen sich eine Wohnung teilen' },
    afterdark: { label: 'Nach Einbruch', subtitle: 'Künstliches Licht über Deutschland' },
    wind: { label: 'Wind', subtitle: 'Die Energiewende als Landschaft' },
    rain: { label: 'Regen', subtitle: 'Ein Jahr Niederschlag, vom trockenen Osten zu den Alpen' },
    land: { label: 'Boden', subtitle: 'Woraus der Boden besteht, und wie viel davon bebaut ist' },
    forest: {
      label: 'Wald',
      subtitle: 'Wo der Wald steht, und wie viel davon seit 1985 gestört wurde',
    },
  },
};

/** Metric labels are written by the pipelines in English; the ones the app
 *  puts on screen (legend title, tooltip rows) get a German twin here. The
 *  key is the metric id with a trailing year stripped. */
const METRIC_TEXT: Record<Lang, Record<string, string>> = {
  en: {},
  de: {
    population: 'Einwohner',
    population_2011: 'Einwohner 2011',
    population_2022: 'Einwohner 2022',
    age_mean: 'Durchschnittsalter',
    rent: 'Nettokaltmiete',
    homes: 'Vermietete Wohnungen',
    homes_total: 'Wohnungen',
    homes_new_share: 'Baujahr ab 2014',
    vacancy_rate: 'Leerstandsquote',
    household_size: 'Durchschnittliche Haushaltsgröße',
    heating_category: 'Dominanter Energieträger',
    light: 'Nachtlicht',
    wind_mw: 'Installierte Windleistung',
    rain_mm: 'Jahresniederschlag',
    built_share: 'Bebaute Fläche',
    land_class: 'Bodenbedeckung',
    forest_share: 'Waldanteil',
    disturbed_share: 'Gestörter Wald seit 1985',
    disturbance_agent: 'Ursache der Störung',
  },
};

/** Units that are words rather than symbols. mm, MW, %, €/m² and
 *  nW/cm²/sr read the same in both languages and are left alone. */
const UNIT_TEXT: Record<Lang, Record<string, string>> = {
  en: {},
  de: { years: 'Jahre', people: 'Personen', homes: 'Wohnungen', 'per home': 'pro Wohnung' },
};

export function unitText(lang: Lang, unit: string): string {
  return UNIT_TEXT[lang]?.[unit] ?? unit;
}

/** Land-cover group names, in the order pipelines/clc5/clc5/classes.py writes. */
const LAND_CLASSES: Record<Lang, string[]> = {
  en: [],
  de: [
    'Siedlung',
    'Industrie & Verkehr',
    'Grünflächen & Sport',
    'Acker & Kulturen',
    'Weide',
    'Wald',
    'Offene Natur',
    'Wasser & Feuchtgebiet',
  ],
};

/** Heating carriers, in the order run_all_metrics.py declares them. The
 *  pipeline labels are German, so English is the translation here. */
const HEATING_SOURCES: Record<Lang, string[]> = {
  en: [
    'Gas',
    'Heating oil',
    'District heat',
    'Solar & heat pump',
    'Electricity',
    'Wood & pellets',
    'Biomass & biogas',
    'Coal',
    'None',
  ],
  de: [],
};

/** Disturbance causes, in the order forest/raster.py writes them. */
const FOREST_AGENTS: Record<Lang, string[]> = {
  en: [],
  de: ['Wind & Borkenkäfer', 'Feuer', 'Holzernte', 'Gemischt'],
};

export function translate(lang: Lang, key: string): string {
  const dict = lang === 'de' ? DE : EN;
  return dict[key] ?? EN[key] ?? key;
}

export function modeText(
  lang: Lang,
  id: string,
  fallback: { label: string; subtitle?: string },
): { label: string; subtitle: string } {
  const hit = MODE_TEXT[lang]?.[id];
  return {
    label: hit?.label ?? fallback.label,
    subtitle: hit?.subtitle ?? fallback.subtitle ?? '',
  };
}

/** `light_2016` and `light` both resolve to the same entry. */
export function metricText(lang: Lang, id: string, fallback: string): string {
  const table = METRIC_TEXT[lang];
  if (!table) return fallback;
  const yearless = id.replace(/_(1[89]|20)\d{2}$/, '');
  const year = id.match(/_((?:1[89]|20)\d{2})$/)?.[1];
  const hit = table[id] ?? table[yearless];
  if (!hit) return fallback;
  return year && !table[id] ? `${hit} ${year}` : hit;
}

export function categoryText(lang: Lang, metricId: string, index: number, fallback: string): string {
  if (metricId.startsWith('land_class')) {
    return LAND_CLASSES[lang]?.[index] ?? fallback;
  }
  if (metricId.startsWith('disturbance_agent')) {
    return FOREST_AGENTS[lang]?.[index] ?? fallback;
  }
  if (metricId.startsWith('heating_category')) {
    return HEATING_SOURCES[lang]?.[index] ?? fallback;
  }
  return fallback;
}
