// Place name plus two or three values, read straight from the metric
// buffers by cell index.

import { useMemo } from 'react';
import type { SculptureMode, TooltipFieldDefinition } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { metricForScene } from '../data/loader';
import { CHANGE_PCT_METRIC } from '../modes/modes';
import { nearestStep } from '../modes/time';
import type { TargetBuilder } from '../sculpture/targets';
import { useAtlasStore } from '../state/store';
import { useI18n, type Lang } from '../i18n';
import { dec1Format, intFormat } from '../i18n/format';
import { categoryText, unitText } from '../i18n/strings';

// nearest labelled city within maxKm, used as the headline
function nearestCity(scene: SceneData, index: number, maxKm = 35): string | null {
  const lon = scene.positions[index * 2]!;
  const lat = scene.positions[index * 2 + 1]!;
  const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
  let best: string | null = null;
  let bestD = maxKm * maxKm;
  for (const city of scene.cities) {
    const dx = (city.lon - lon) * kmPerDegLon;
    const dy = (city.lat - lat) * 111.13;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = city.name;
    }
  }
  return best;
}

function formatField(
  locale: string,
  lang: Lang,
  field: TooltipFieldDefinition,
  value: number,
  scene: SceneData,
): string {
  if (Number.isNaN(value)) return '—';
  const intFmt = intFormat(locale);
  const dec1Fmt = dec1Format(locale);
  // a bare number carries whatever unit the pipeline declared, so night
  // light reads "12,4 nW/cm²/sr" rather than "12,4"
  const declared = metricForScene(scene, field.metric).unit;
  const suffix = declared ? ` ${unitText(lang, declared)}` : '';
  switch (field.format) {
    case 'integer':
      return `${intFmt.format(Math.round(value))}${suffix}`;
    case 'decimal1':
      return `${dec1Fmt.format(value)}${suffix}`;
    case 'percent': {
      const pct = value * 100;
      return `${pct > 0 ? '+' : ''}${dec1Fmt.format(pct)} %`;
    }
    case 'currencyPerSqm':
      return `${dec1Fmt.format(value)} €/m²`;
    case 'megawatt':
      return `${dec1Fmt.format(value)} MW`;
    case 'millimetre':
      return `${intFmt.format(Math.round(value))} mm`;
    case 'category': {
      const def = metricForScene(scene, field.metric);
      const index = Math.round(value);
      const raw = def.categories?.[index];
      return raw ? categoryText(lang, field.metric, index, raw) : '—';
    }
  }
}

interface Props {
  mode: SculptureMode;
  scene: SceneData;
  builder: TargetBuilder;
}

export function Tooltip({ mode, scene, builder }: Props) {
  const hover = useAtlasStore((s) => s.hover);
  const timeT = useAtlasStore((s) => s.timeT);
  const i18n = useI18n();

  const content = useMemo(() => {
    if (!hover) return null;
    const place = nearestCity(scene, hover.index);
    // A field that follows the timeline (rain of a year, wind of a year)
    // must read the year on screen, not the latest one the mode binds to.
    const time = mode.time;
    const shownStep = time ? time.steps[nearestStep(timeT, time.steps.length)]! : null;
    const stepOf = (metric: string) => {
      if (!time || !shownStep) return null;
      const follows = time.steps.some(
        (s) => time.metricTemplate.replace('{step}', s) === metric,
      );
      return follows ? shownStep : null;
    };
    const rows = mode.tooltip.fields
      .filter(
        (field) =>
          field.metric === CHANGE_PCT_METRIC ||
          scene.dataset.metrics.some((m) => m.id === field.metric) ||
          stepOf(field.metric) !== null,
      )
      .map((field) => {
        const step = stepOf(field.metric);
        const metric = step ? time!.metricTemplate.replace('{step}', step) : field.metric;
        // a picked fine cell brings its own values; anything it lacks
        // (rare: a tooltip metric that is neither height nor colour) falls
        // back to the country cell beneath
        const fine = hover.fine?.[metric];
        const value = fine !== undefined ? fine : builder.resolveMetric(metric).values[hover.index]!;
        const label = i18n.metric(field.metric, field.label);
        return {
          label: step ? `${label} ${step}` : label,
          value: formatField(i18n.locale, i18n.lang, field, value, scene),
        };
      });
    return { place, rows, fine: hover.fine !== undefined };
  }, [hover, mode, scene, builder, timeT, i18n]);

  if (!hover || !content) return null;

  return (
    <div className="tooltip" style={{ left: hover.x, top: hover.y }} data-fine={content.fine ? '1' : undefined}>
      {content.place && <p className="tooltip__place">{content.place.toUpperCase()}</p>}
      {content.rows.map((row) => (
        <div key={row.label} className="tooltip__row">
          <div className="tooltip__label">{row.label}</div>
          <div className="tooltip__value">{row.value}</div>
        </div>
      ))}
    </div>
  );
}
