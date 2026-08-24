// Viewer settings (shadows, light, quality, labels, motion). Everything
// applies live and is remembered in localStorage; the URL switches
// `?quality=` and `?shadows=0` still win, for testing.

import { useRef } from 'react';
import {
  DEFAULT_SETTINGS,
  LIGHT_ELEVATION_RANGE,
  SHADOW_STRENGTH_RANGE,
  type Settings,
} from '../state/settings';
import { useAtlasStore } from '../state/store';
import { useI18n } from '../i18n';
import { useDialogFocus } from './useDialogFocus';
import { launchParam } from '../state/url';

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

/** A few that suit paper, and a free picker for anything else. */
const BORDER_COLORS = ['#221c15', '#8a8378', '#b81d74', '#2f6b4a', '#3e6fb8'];

export function SettingsDialog({ onClose }: Props) {
  const settings = useAtlasStore((s) => s.settings);
  const update = useAtlasStore((s) => s.updateSettings);
  const quality = useAtlasStore((s) => s.quality);
  const panel = useRef<HTMLDivElement>(null);

  useDialogFocus(panel, onClose);

  const { t } = useI18n();
  const forcedQuality = launchParam('quality');
  const forcedShadowsOff = launchParam('shadows') === '0';
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
            {t('settings.title')}
          </p>
          <button type="button" className="dialog__close" onClick={onClose} aria-label={t('ui.close')}>
            ×
          </button>
        </div>

        <Segment
          label={t('settings.shadows')}
          value={settings.shadows}
          choices={[
            {
              value: 'auto',
              label: `${t('settings.auto')} (${t(quality.shadows ? 'settings.on' : 'settings.off')})`,
            },
            { value: 'on', label: t('settings.on') },
            { value: 'off', label: t('settings.off') },
          ]}
          onChange={set('shadows')}
        />
        {forcedShadowsOff && <p className="settings__note">?shadows=0 in the URL keeps them off.</p>}
        <Slider
          label={t('settings.shadowStrength')}
          value={settings.shadowStrength}
          range={SHADOW_STRENGTH_RANGE}
          step={0.01}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={set('shadowStrength')}
        />
        <Slider
          label={t('settings.lightElevation')}
          value={settings.lightElevation}
          range={LIGHT_ELEVATION_RANGE}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={set('lightElevation')}
        />
        <Segment
          label={t('settings.quality')}
          value={settings.quality}
          choices={[
            { value: 'auto', label: `${t('settings.auto')} (${quality.id})` },
            { value: 'desktop', label: t('settings.desktop') },
            { value: 'mobile', label: t('settings.mobile') },
          ]}
          onChange={set('quality')}
        />
        {forcedQuality && <p className="settings__note">?quality= in the URL overrides this.</p>}
        <Segment
          label={t('settings.labels')}
          value={settings.labels}
          choices={[
            { value: 'auto', label: t('settings.auto') },
            { value: 'major', label: t('settings.major') },
            { value: 'all', label: t('settings.all') },
            { value: 'none', label: t('settings.none') },
          ]}
          onChange={set('labels')}
        />
        <Segment
          label={t('settings.border')}
          value={settings.border ? 'on' : 'off'}
          choices={[
            { value: 'off', label: t('settings.off') },
            { value: 'on', label: t('settings.on') },
          ]}
          onChange={(v) => update({ border: v === 'on' })}
        />
        {settings.border && (
          <div className="settings__row">
            <span className="settings__label">{t('settings.borderColor')}</span>
            <div className="settings__swatches">
              {BORDER_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`settings__swatch${
                    settings.borderColor.toLowerCase() === hex ? ' settings__swatch--active' : ''
                  }`}
                  style={{ background: hex }}
                  aria-label={hex}
                  aria-pressed={settings.borderColor.toLowerCase() === hex}
                  onClick={() => update({ borderColor: hex })}
                />
              ))}
              <input
                type="color"
                className="settings__color"
                value={settings.borderColor}
                aria-label={t('settings.borderColor')}
                onChange={(e) => update({ borderColor: e.target.value })}
              />
            </div>
          </div>
        )}
        <Segment
          label={t('settings.motion')}
          value={settings.motion}
          choices={[
            { value: 'auto', label: t('settings.auto') },
            { value: 'full', label: t('settings.full') },
            { value: 'reduced', label: t('settings.reduced') },
          ]}
          onChange={set('motion')}
        />

        <div className="dialog__row">
          <span className="dialog__hint">{t('ui.rememberedHere')}</span>
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
