// Viewer settings (shadows, light, quality, labels, motion). Everything
// applies live and is remembered in localStorage; the URL switches
// `?quality=` and `?shadows=0` still win, for testing.

import { useEffect, useRef } from 'react';
import {
  DEFAULT_SETTINGS,
  LIGHT_ELEVATION_RANGE,
  SHADOW_STRENGTH_RANGE,
  type Settings,
} from '../state/settings';
import { useAtlasStore } from '../state/store';

interface Props {
  onClose: () => void;
}

interface Choice<T extends string> {
  value: T;
  label: string;
}

function Segment<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: Choice<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="settings__row">
      <span className="settings__label">{label}</span>
      <div className="settings__segment" role="group" aria-label={label}>
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`export__format${c.value === value ? ' export__format--active' : ''}`}
            aria-pressed={c.value === value}
            onClick={() => onChange(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  range,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  range: [number, number];
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="settings__row">
      <span className="settings__label">{label}</span>
      <input
        type="range"
        className="settings__slider"
        min={range[0]}
        max={range[1]}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="settings__value">{format(value)}</span>
    </div>
  );
}

export function SettingsDialog({ onClose }: Props) {
  const settings = useAtlasStore((s) => s.settings);
  const update = useAtlasStore((s) => s.updateSettings);
  const quality = useAtlasStore((s) => s.quality);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const forcedQuality = new URLSearchParams(window.location.search).get('quality');
  const forcedShadowsOff = new URLSearchParams(window.location.search).get('shadows') === '0';
  const set = <K extends keyof Settings>(key: K) => (v: Settings[K]) => update({ [key]: v });

  return (
    <div className="dialog" onClick={onClose} role="presentation">
      <div
        className="dialog__panel settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">
          <p id="settings-title" className="dialog__title">
            Settings
          </p>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <Segment
          label="Shadows"
          value={settings.shadows}
          choices={[
            { value: 'auto', label: `Auto (${quality.shadows ? 'on' : 'off'})` },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={set('shadows')}
        />
        {forcedShadowsOff && <p className="settings__note">?shadows=0 in the URL keeps them off.</p>}
        <Slider
          label="Shadow strength"
          value={settings.shadowStrength}
          range={SHADOW_STRENGTH_RANGE}
          step={0.01}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={set('shadowStrength')}
        />
        <Slider
          label="Light elevation"
          value={settings.lightElevation}
          range={LIGHT_ELEVATION_RANGE}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={set('lightElevation')}
        />
        <Segment
          label="Quality"
          value={settings.quality}
          choices={[
            { value: 'auto', label: `Auto (${quality.id})` },
            { value: 'desktop', label: 'Desktop' },
            { value: 'mobile', label: 'Mobile' },
          ]}
          onChange={set('quality')}
        />
        {forcedQuality && <p className="settings__note">?quality= in the URL overrides this.</p>}
        <Segment
          label="City labels"
          value={settings.labels}
          choices={[
            { value: 'auto', label: 'Auto' },
            { value: 'major', label: 'Major' },
            { value: 'all', label: 'All' },
            { value: 'none', label: 'None' },
          ]}
          onChange={set('labels')}
        />
        <Segment
          label="Motion"
          value={settings.motion}
          choices={[
            { value: 'auto', label: 'Auto' },
            { value: 'full', label: 'Full' },
            { value: 'reduced', label: 'Reduced' },
          ]}
          onChange={set('motion')}
        />

        <div className="dialog__row">
          <span className="dialog__hint">Remembered in this browser</span>
          <button
            type="button"
            className="export__format"
            onClick={() => update({ ...DEFAULT_SETTINGS })}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
