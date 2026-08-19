// EXPORT opens the poster dialog (plan §100) — also on the E key, mirroring
// the prototype. Formats and the render button live in the dialog.

import { useEffect, useState } from 'react';
import type { TargetBuilder } from '../sculpture/targets';
import { ExportDialog } from './ExportDialog';
import { useI18n } from '../i18n';

interface Props {
  builder: TargetBuilder;
}

export function ExportButton({ builder }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="export__go"
        onClick={() => setOpen(true)}
        title={t('export.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {t('ui.export')}
      </button>
      {open && <ExportDialog builder={builder} onClose={() => setOpen(false)} />}
    </>
  );
}
