// Place name plus two or three values, read straight from the metric
// buffers by cell index.

import { useMemo } from 'react';
import type { SculptureMode, TooltipFieldDefinition } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { metricForScene } from '../data/loader';
import { CHANGE_PCT_METRIC } from '../modes/modes';
import type { TargetBuilder } from '../sculpture/targets';
import { useAtlasStore } from '../state/store';

const intFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const dec1Fmt = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

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
  field: TooltipFieldDefinition,
  value: number,
  scene: SceneData,
): string {
  if (Number.isNaN(value)) return '—';
  switch (field.format) {
    case 'integer':
      return intFmt.format(Math.round(value));
    case 'decimal1':
      return dec1Fmt.format(value);
    case 'percent': {
      const pct = value * 100;
      return `${pct > 0 ? '+' : ''}${dec1Fmt.format(pct)} %`;
    }
    case 'currencyPerSqm':
      return `${dec1Fmt.format(value)} €/m²`;
    case 'megawatt':
      return `${dec1Fmt.format(value)} MW`;
    case 'category': {
      const def = metricForScene(scene, field.metric);
      return def.categories?.[Math.round(value)] ?? '—';
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

  const content = useMemo(() => {
    if (!hover) return null;
    const place = nearestCity(scene, hover.index);
    const rows = mode.tooltip.fields
      .filter(
        (field) =>
          field.metric === CHANGE_PCT_METRIC ||
          scene.dataset.metrics.some((m) => m.id === field.metric),
      )
      .map((field) => {
        const { values } = builder.resolveMetric(field.metric);
        return {
          label: field.label,
          value: formatField(field, values[hover.index]!, scene),
        };
      });
    return { place, rows };
  }, [hover, mode, scene, builder]);

  if (!hover || !content) return null;

  return (
    <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
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
