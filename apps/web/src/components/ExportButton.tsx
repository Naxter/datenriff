// EXPORT renders the current view as a 4K poster PNG — plan §100. Also on
// the E key, mirroring the prototype.

import { useCallback, useEffect, useState } from 'react';
import { getMode } from '../modes/modes';
import { requestSculptureCapture } from '../sculpture/exportBridge';
import { composePoster } from '../sculpture/exportPoster';
import type { TargetBuilder } from '../sculpture/targets';
import { useAtlasStore } from '../state/store';

interface Props {
  builder: TargetBuilder;
}

export function ExportButton({ builder }: Props) {
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (busy) return;
    const s = useAtlasStore.getState();
    if (!s.scene) return;
    const mode = getMode(s.modeId);
    setBusy(true);
    try {
      const frame = await requestSculptureCapture();
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
  }, [busy, builder]);

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
    <button
      type="button"
      className="export"
      onClick={() => void run()}
      disabled={busy}
      title="4K poster PNG (E)"
    >
      {busy ? 'Rendering …' : 'Export'}
    </button>
  );
}
