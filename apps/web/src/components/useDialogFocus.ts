// Keyboard behaviour a modal dialog owes its user.
//
// The dialogs focused their own panel and stopped there: Tab walked straight
// out into the atlas behind them, a screen reader read the whole page as if
// the dialog were part of it, and closing left the focus wherever it had
// wandered — so a keyboard user was returned to the top of the document
// instead of to the button they had just pressed.
//
// Three things, in one place:
//   - focus moves into the dialog, and Tab stays inside it;
//   - the rest of the page is `inert` while it is open, which takes it out of
//     the tab order and out of the accessibility tree at once;
//   - focus returns to whatever opened the dialog.

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useDialogFocus(panel: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.querySelector<HTMLElement>('.atlas');
    // Everything except the branch the dialog is in. Marking siblings by
    // class is not enough: a dialog is rendered by the control that opens
    // it, so it lives *inside* one of these children rather than beside
    // them — inerting that child disables the dialog with it.
    const muted = root
      ? [...root.children].filter(
          (el): el is HTMLElement => !(panel.current && el.contains(panel.current)),
        )
      : [];
    for (const el of muted) el.setAttribute('inert', '');

    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = focusable(panel.current);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      // wrap at both ends, and catch the case where focus is on the panel
      if (e.shiftKey && (active === first || active === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      for (const el of muted) el.removeAttribute('inert');
      // the opener may be gone (a dialog that closed itself away)
      if (opener?.isConnected) opener.focus();
    };
  }, [panel, onClose]);
}
