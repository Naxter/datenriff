// Top-left row: EXPORT (poster dialog) and SETTINGS.

import { useCallback, useEffect } from 'react';
import type { TargetBuilder } from '../sculpture/targets';
import { useAtlasStore } from '../state/store';
import type { SceneData } from '../data/loader';
import { ExportButton } from './ExportButton';
import { FocusButton } from './FocusButton';
import { SettingsDialog } from './SettingsDialog';

interface Props {
  builder: TargetBuilder;
  scene: SceneData;
}

export function Toolbar({ builder, scene }: Props) {
  const open = useAtlasStore((s) => s.settingsOpen);
  const setOpen = useAtlasStore((s) => s.setSettingsOpen);
  const close = useCallback(() => setOpen(false), [setOpen]);

  // S toggles settings, mirroring E for export
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        setOpen(!useAtlasStore.getState().settingsOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return (
    <div className="export">
      <ExportButton builder={builder} />
      <FocusButton scene={scene} />
      <button
        type="button"
        className="export__go"
        onClick={() => setOpen(true)}
        title="Settings (S)"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Settings
      </button>
      {open && <SettingsDialog onClose={close} />}
    </div>
  );
}
