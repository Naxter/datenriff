// EXPORT renders the current view as a 4K poster PNG — plan §100. Also on
// the E key, mirroring the prototype.

import { useCallback, useEffect, useState } from 'react';
import { getMode } from '../modes/modes';
import {
  DEFAULT_FORMAT,
  EXPORT_FORMATS,
  requestSculptureCapture,
  type ExportFormat,
} from '../sculpture/exportBridge';
import { composePoster } from '../sculpture/exportPoster';
import type { TargetBuilder } from '../sculpture/targets';
import { useAtlasStore } from '../state/store';

interface Props {
  builder: TargetBuilder;
}

export function ExportButton({ builder }: Props) {
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<ExportFormat>(DEFAULT_FORMAT);

  const run = useCallback(async () => {
    if (busy) return;
    const s = useAtlasStore.getState();
    if (!s.scene) return;
    const mode = getMode(s.modeId);
    setBusy(true);
    try {
      const frame = await requestSculptureCapture(format);
      await composePoster(frame, {
        scene: s.scene,
        mode,
        palette: s.palette,
        colorStats: builder.build(mode, s.palette).colorStats,
      });
    } catch (e) {
      console.error('poster export failed:', e);
    } finally {
      setBusy(false);
    }
  }, [busy, builder, format]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        void run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  return (
    <div className="export">
      <button
        type="button"
        className="export__go"
        onClick={() => void run()}
        disabled={busy}
        title={`Poster PNG, ${format.label} (E)`}
      >
        {busy ? 'Rendering …' : 'Export'}
      </button>
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
    </div>
  );
}
