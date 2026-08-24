// Top-left row: what you can do with the view — export it, configure it,
// read it in another language. What you are *looking at* (modes, focus)
// belongs with the navigation instead.

import { useCallback, useEffect, useRef, useState } from 'react';
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

  // On a phone the three tools spelled out took a whole row of a screen the
  // sculpture needs, and in German ("Einstellungen") most of its width. They
  // fold behind one button there; on a wide screen the button is not
  // rendered at all and the row is what it always was.
  const [menuOpen, setMenuOpen] = useState(false);
  const tools = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!tools.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className={`export${menuOpen ? ' export--menu-open' : ''}`} ref={tools}>
      <button
        type="button"
        className="export__toggle"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-label={t('ui.tools')}
      >
        {t('ui.tools')}
      </button>
      <div className="export__tools">
        <ExportButton builder={builder} />
        <button
          type="button"
          className="export__go"
          onClick={() => {
            setMenuOpen(false);
            setOpen(true);
          }}
          title={`${t('ui.settings')} (S)`}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {t('ui.settings')}
        </button>
        <LanguageSwitch />
      </div>
      {open && <SettingsDialog onClose={close} />}
    </div>
  );
}
