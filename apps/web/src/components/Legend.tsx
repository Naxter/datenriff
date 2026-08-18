import { useMemo } from 'react';
import type { MetricStats, SculptureMode } from '@datenriff/data-contracts';
import {
  SEQUENTIAL_CHOICES,
  legendGradient,
  resolveDivergingHalfWidth,
  resolveSequentialDomain,
} from '@datenriff/color-scales';
import type { SceneData } from '../data/loader';
import { metricForScene } from '../data/loader';
import { CHANGE_PCT_METRIC } from '../modes/modes';
import { nearestStep } from '../modes/time';
import { effectiveColorScale } from '../sculpture/targets';
import { useAtlasStore } from '../state/store';

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

function formatValue(v: number, unit?: string): string {
  const compact =
    Math.abs(v) >= 10_000 ? `${nf.format(Math.round(v / 1000))}k` : nf.format(v);
  if (unit === '€/m²') return `${v} €/m²`;
  if (unit === 'MW') return `${compact} MW`;
  return compact;
}

const cssGradient = (id: string) =>
  `linear-gradient(to right, ${legendGradient(id).join(', ')})`;

interface Props {
  mode: SculptureMode;
  scene: SceneData;
  colorStats: MetricStats;
}

export function Legend({ mode, scene, colorStats }: Props) {
  const palette = useAtlasStore((s) => s.palette);
  const setPalette = useAtlasStore((s) => s.setPalette);
  const scale = effectiveColorScale(mode, palette);
  const isSequential =
    scale.type === 'linear' || scale.type === 'sqrt' || scale.type === 'log1p';

  const body = useMemo(() => {
    if (scale.type === 'categorical') {
      const def = metricForScene(scene, mode.colorMetric);
      const colors = legendGradient(scale.palette);
      return (
        <div className="legend__cats">
          {(def.categories ?? []).map((label, i) => (
            <div key={label} className="legend__cat">
              <span className="legend__swatch" style={{ background: colors[i] }} />
              {label}
            </div>
          ))}
        </div>
      );
    }

    if (scale.type === 'diverging') {
      const hw = resolveDivergingHalfWidth(scale, colorStats);
      return (
        <>
          <div className="legend__bar" style={{ background: cssGradient(scale.palette) }} />
          <div className="legend__range">
            <span>−{Math.round(hw * 100)} %</span>
            <span>0</span>
            <span>+{Math.round(hw * 100)} %</span>
          </div>
        </>
      );
    }

    const [lo, hi] = resolveSequentialDomain(scale, colorStats);
    const unit = metricForScene(scene, mode.colorMetric).unit;
    return (
      <>
        <div className="legend__bar" style={{ background: cssGradient(scale.palette) }} />
        <div className="legend__range">
          <span>{formatValue(lo, unit)}</span>
          <span>{formatValue(hi, unit)}</span>
        </div>
      </>
    );
  }, [scale, scene, mode.colorMetric, colorStats]);

  // when colour follows the timeline (a year of night light), the title
  // names the year currently shown, not the latest one
  const timeT = useAtlasStore((s) => s.timeT);
  const stepMetric =
    mode.time && mode.colorMetric === mode.heightMetric
      ? mode.time.metricTemplate.replace(
          '{step}',
          mode.time.steps[nearestStep(timeT, mode.time.steps.length)]!,
        )
      : mode.colorMetric;
  const title =
    mode.colorMetric === CHANGE_PCT_METRIC
      ? 'Population change'
      : metricForScene(scene, stepMetric).label;

  const choices = useMemo(() => {
    const base = mode.colorScale.palette;
    return [base, ...SEQUENTIAL_CHOICES.filter((p) => p !== base)].slice(0, 7);
  }, [mode.colorScale.palette]);

  return (
    <div className="legend">
      <p className="legend__title">{title}</p>
      {body}
      {isSequential && (
        <div className="legend__palettes" role="group" aria-label="Colour ramp">
          {choices.map((id) => {
            const active = scale.palette === id;
            return (
              <button
                key={id}
                type="button"
                title={id}
                aria-pressed={active}
                className={`legend__dot${active ? ' legend__dot--active' : ''}`}
                style={{ background: cssGradient(id) }}
                onClick={() => setPalette(id === mode.colorScale.palette ? null : id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
