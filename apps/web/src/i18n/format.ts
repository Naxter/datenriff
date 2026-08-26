// Number and date formatters per locale, made once and reused. Numbers were
// always German ("4.807"); with a language switch that becomes a choice.

const integer = new Map<string, Intl.NumberFormat>();
const decimal1 = new Map<string, Intl.NumberFormat>();

export function intFormat(locale: string): Intl.NumberFormat {
  let f = integer.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    integer.set(locale, f);
  }
  return f;
}

export function dec1Format(locale: string): Intl.NumberFormat {
  let f = decimal1.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    decimal1.set(locale, f);
  }
  return f;
}

/** The legend's number rule, shared with the poster export so the two can
 *  never drift: a share reads as a rounded percentage, values from 10 000
 *  compact to "Nk", anything else prints the unit it was handed. */
export function formatMetricValue(
  locale: string,
  v: number,
  unit?: string,
  aggregation?: string,
): string {
  const nf = intFormat(locale);
  if (aggregation === 'share') return `${nf.format(Math.round(v * 100))} %`;
  const compact = Math.abs(v) >= 10_000 ? `${nf.format(Math.round(v / 1000))}k` : nf.format(v);
  return unit ? `${compact} ${unit}` : compact;
}

export function longDate(locale: string, iso: string): string {
  // a date-only ISO string parses as UTC midnight, so it must be formatted
  // in UTC too — otherwise a viewer west of Greenwich reads the day before
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
