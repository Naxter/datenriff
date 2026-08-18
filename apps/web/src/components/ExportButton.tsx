// EXPORT opens the poster dialog (plan §100) — also on the E key, mirroring
// the prototype. Formats and the render button live in the dialog.

import { useEffect, useState } from 'react';
import type { TargetBuilder } from '../sculpture/targets';
import { ExportDialog } from './ExportDialog';

interface Props {
  builder: TargetBuilder;
}

export function ExportButton({ builder }: Props) {
  const [open, setOpen] = useState(false);

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
        title="Poster PNG (E)"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Export
      </button>
      {open && <ExportDialog builder={builder} onClose={() => setOpen(false)} />}
    </>
  );
}
