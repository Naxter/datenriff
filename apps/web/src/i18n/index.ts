// Language resolution and the hook the components use.
//
// Order: `?lang=` wins (so a link can pin a language), then what the viewer
// chose here before, then the browser. English is the fallback.

import { useAtlasStore } from '../state/store';
import {
  LANGS,
  LOCALE,
  categoryText,
  metricText,
  modeText,
  translate,
  unitText,
  type Lang,
} from './strings';
import { launchParam } from '../state/url';

export type { Lang };
export { LANGS, LOCALE };

const KEY = 'datenriff:lang';

export function detectLang(): Lang {
  const forced = launchParam('lang');
  if (forced && (LANGS as string[]).includes(forced)) return forced as Lang;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && (LANGS as string[]).includes(stored)) return stored as Lang;
  } catch {
    // storage unavailable — fall through to the browser
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** Tell the document which language it is in. index.html ships `lang="de"`
 *  as a static guess; a screen reader otherwise pronounces an English page
 *  with a German voice, and the fallback screen picks the wrong words. */
export function applyDocumentLang(lang: Lang): void {
  document.documentElement.lang = lang;
}

export function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // the choice lives for this session only
  }
}

/** Translator plus the formatters that have to follow the language. */
export function useI18n() {
  const lang = useAtlasStore((s) => s.lang);
  return {
    lang,
    t: (key: string) => translate(lang, key),
    mode: (id: string, fallback: { label: string; subtitle?: string }) =>
      modeText(lang, id, fallback),
    metric: (id: string, fallback: string) => metricText(lang, id, fallback),
    category: (metricId: string, index: number, fallback: string) =>
      categoryText(lang, metricId, index, fallback),
    unit: (unit: string) => unitText(lang, unit),
    locale: LOCALE[lang],
  };
}
