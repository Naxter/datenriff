// Poster export dialog: pick a social format, see the real composition as
// a small preview (a genuine low-resolution capture run through the same
// poster code as the 4K file), then render.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getMode } from '../modes/modes';
import {
  DEFAULT_FORMAT,
  EXPORT_FORMATS,
  requestSculptureCapture,
  type ExportFormat,
} from '../sculpture/exportBridge';
import { composePoster, renderPoster, type PosterContext } from '../sculpture/exportPoster';
import {
  ANIMATION_PRESETS,
  downloadBytes,
  renderAnimation,
} from '../sculpture/exportAnimation';
import type { TargetBuilder } from '../sculpture/targets';
import { useAtlasStore } from '../state/store';
import { useI18n } from '../i18n';

/** Poster resolutions. The capture is CSS pixels; the multiplier is how
 *  many device pixels each becomes, so 2× of 1920×1080 is a 4K file. */
const QUALITIES = [
  { id: 'screen', label: '1×', dpr: 1 },
  { id: 'print', label: '2×', dpr: 2 },
  { id: 'large', label: '3×', dpr: 3 },
];

/** Preview frame: a fraction of the poster's CSS size, quick to render. */
const PREVIEW_DPR = 0.3;

interface Props {
  builder: TargetBuilder;
  onClose: () => void;
}

export function ExportDialog({ builder, onClose }: Props) {
  const [format, setFormat] = useState<ExportFormat>(DEFAULT_FORMAT);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'render' | null>(null);
  const [quality, setQuality] = useState(QUALITIES[1]!);
  const [kind, setKind] = useState<'image' | 'animation'>('image');
  const [animation, setAnimation] = useState(ANIMATION_PRESETS[0]!);
  const [progress, setProgress] = useState(0);
  const { t } = useI18n();
  const mode = getMode(
    useAtlasStore((st) => st.modeId),
    useAtlasStore((st) => st.scene)?.dataset,
  );
  const setTimeT = useAtlasStore((st) => st.setTimeT);
  const canAnimate = (mode.time?.steps.length ?? 0) >= 2;
  const panel = useRef<HTMLDivElement>(null);
  // captures share the one live canvas, so they run one after another
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const posterContext = useCallback((): PosterContext | null => {
    const s = useAtlasStore.getState();
    if (!s.scene) return null;
    const mode = getMode(s.modeId, s.scene.dataset);
    return {
      scene: s.scene,
      mode,
      palette: s.palette,
      // the poster is of what is on screen: this year, this language
      timeT: s.timeT,
      lang: s.lang,
      colorStats: builder.build(mode, s.palette).colorStats,
      // the boundary credit is owed on paper too, whenever VG2500 shaped
      // what the frame shows
      boundaryCredit: s.focus?.kind === 'state' || s.settings.border ? s.bkgCredit : null,
    };
  }, [builder]);

  // preview follows the chosen format
  useEffect(() => {
    let cancelled = false;
    setBusy('preview');
    const job = queue.current.then(async () => {
      const ctx = posterContext();
      if (!ctx || cancelled) return;
      const frame = await requestSculptureCapture(format, PREVIEW_DPR);
      const canvas = await renderPoster(frame, ctx, format, PREVIEW_DPR);
      if (!cancelled) setPreview(canvas.toDataURL('image/png'));
    });
    queue.current = job.catch((e: unknown) => console.error('poster preview failed:', e));
    void queue.current.then(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
  }, [format, posterContext]);

  const render = useCallback(async () => {
    if (busy === 'render') return;
    setBusy('render');
    const job = queue.current.then(async () => {
      const ctx = posterContext();
      if (!ctx) return;
      const frame = await requestSculptureCapture(format, quality.dpr);
      await composePoster(frame, ctx, quality.dpr);
    });
    queue.current = job.catch((e: unknown) => console.error('poster export failed:', e));
    await queue.current;
    setBusy(null);
  }, [busy, format, quality, posterContext]);

  const renderGif = useCallback(async () => {
    if (busy === 'render') return;
    setBusy('render');
    setProgress(0);
    const job = queue.current.then(async () => {
      const ctx = posterContext();
      if (!ctx) return;
      const bytes = await renderAnimation(
        mode,
        format,
        ctx,
        animation.options,
        setTimeT,
        () => useAtlasStore.getState().timeT,
        setProgress,
      );
      downloadBytes(bytes, `vertical-atlas-${mode.id}-${format.id}.gif`, 'image/gif');
    });
    queue.current = job.catch((e: unknown) => console.error('animation export failed:', e));
    await queue.current;
    setBusy(null);
  }, [busy, format, animation, mode, posterContext, setTimeT]);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter') void (kind === 'animation' ? renderGif() : render());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, render, renderGif, kind]);

  const px =
    kind === 'animation'
      ? `${animation.options.frames} × ${animation.options.maxEdge} px`
      : `${Math.round(format.width * quality.dpr)} × ${Math.round(format.height * quality.dpr)} px`;

  return (
    <div className="dialog" onClick={onClose} role="presentation">
      <div
        className="dialog__panel export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">
          <p id="export-dialog-title" className="dialog__title">
            {t('ui.export')}
          </p>
          <button type="button" className="dialog__close" onClick={onClose} aria-label={t('ui.close')}>
            ×
          </button>
        </div>

        <div className={`export-dialog__preview${busy === 'preview' ? ' is-busy' : ''}`}>
          {preview ? (
            <img src={preview} alt={`Poster preview, ${format.label}`} />
          ) : (
            <span className="export-dialog__wait">{t('ui.renderingPreview')}</span>
          )}
        </div>

        <div className="dialog__row">
          <div className="export__formats" role="group" aria-label={t('export.kind')}>
            <button
              type="button"
              className={`export__format${kind === 'image' ? ' export__format--active' : ''}`}
              aria-pressed={kind === 'image'}
              onClick={() => setKind('image')}
            >
              {t('export.image')}
            </button>
            <button
              type="button"
              className={`export__format${kind === 'animation' ? ' export__format--active' : ''}`}
              aria-pressed={kind === 'animation'}
              onClick={() => setKind('animation')}
              disabled={!canAnimate}
              title={canAnimate ? 'GIF' : undefined}
            >
              GIF
            </button>
          </div>
          {kind === 'image' ? (
            <div className="export__formats" role="group" aria-label={t('export.quality')}>
              {QUALITIES.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className={`export__format${q.id === quality.id ? ' export__format--active' : ''}`}
                  aria-pressed={q.id === quality.id}
                  onClick={() => setQuality(q)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="export__formats" role="group" aria-label={t('export.quality')}>
              {ANIMATION_PRESETS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`export__format${a.id === animation.id ? ' export__format--active' : ''}`}
                  aria-pressed={a.id === animation.id}
                  onClick={() => setAnimation(a)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="dialog__row">
          <div className="export__formats" role="group" aria-label={t('export.format')}>
            {EXPORT_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`export__format${f.id === format.id ? ' export__format--active' : ''}`}
                aria-pressed={f.id === format.id}
                onClick={() => setFormat(f)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="dialog__hint">
            {kind === 'animation' ? 'GIF' : 'PNG'} · {px}
          </span>
          <button
            type="button"
            className="dialog__primary"
            onClick={() => void (kind === 'animation' ? renderGif() : render())}
            disabled={busy === 'render'}
          >
            {busy === 'render'
              ? kind === 'animation'
                ? `${t('export.rendering')} ${Math.round(progress * 100)} %`
                : t('export.rendering')
              : t('export.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
