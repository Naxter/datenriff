// Top-left row: what you can do with the view — export it, configure it,
// read it in another language. What you are *looking at* (modes, focus)
// belongs with the navigation instead.

import { useCallback, useEffect } from 'react';
import type { TargetBuilder } from '../sculpture/targets';
import { useAtlasStore } from '../state/store';
import { ExportButton } from './ExportButton';
import { LanguageSwitch } from './LanguageSwitch';
import { SettingsDialog } from './SettingsDialog';
import { useI18n } from '../i18n';

interface Props {
  builder: TargetBuilder;
}

export function Toolbar({ builder }: Props) {
  const open = useAtlasStore((s) => s.settingsOpen);
  const setOpen = useAtlasStore((s) => s.setSettingsOpen);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const { t } = useI18n();

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
      <button
        type="button"
        className="export__go"
        onClick={() => setOpen(true)}
        title={`${t('ui.settings')} (S)`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {t('ui.settings')}
      </button>
      <LanguageSwitch />
      {open && <SettingsDialog onClose={close} />}
    </div>
  );
}
