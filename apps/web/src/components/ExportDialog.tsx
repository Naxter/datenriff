// Poster export dialog: pick a social format, see the real composition as
// a small preview (a genuine low-resolution capture run through the same
// poster code as the 4K file), then render.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getMode } from '../modes/modes';
import {
  DEFAULT_FORMAT,
  EXPORT_DPR,
  EXPORT_FORMATS,
  requestSculptureCapture,
  type ExportFormat,
} from '../sculpture/exportBridge';
import { composePoster, renderPoster, type PosterContext } from '../sculpture/exportPoster';
import type { TargetBuilder } from '../sculpture/targets';
import { useAtlasStore } from '../state/store';

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
  const panel = useRef<HTMLDivElement>(null);
  // captures share the one live canvas, so they run one after another
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const posterContext = useCallback((): PosterContext | null => {
    const s = useAtlasStore.getState();
    if (!s.scene) return null;
    const mode = getMode(s.modeId);
    return {
      scene: s.scene,
      mode,
      palette: s.palette,
      colorStats: builder.build(mode, s.palette).colorStats,
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
      const frame = await requestSculptureCapture(format, EXPORT_DPR);
      await composePoster(frame, ctx);
    });
    queue.current = job.catch((e: unknown) => console.error('poster export failed:', e));
    await queue.current;
    setBusy(null);
  }, [busy, format, posterContext]);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter') void render();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, render]);

  const px = `${format.width * EXPORT_DPR} × ${format.height * EXPORT_DPR}`;

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
            Poster export
          </p>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={`export-dialog__preview${busy === 'preview' ? ' is-busy' : ''}`}>
          {preview ? (
            <img src={preview} alt={`Poster preview, ${format.label}`} />
          ) : (
            <span className="export-dialog__wait">Rendering preview …</span>
          )}
        </div>

        <div className="dialog__row">
          <div className="export__formats" role="group" aria-label="Poster format">
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
          <span className="dialog__hint">PNG · {px} px</span>
          <button
            type="button"
            className="dialog__primary"
            onClick={() => void render()}
            disabled={busy === 'render'}
          >
            {busy === 'render' ? 'Rendering …' : 'Render poster'}
          </button>
        </div>
      </div>
    </div>
  );
}
