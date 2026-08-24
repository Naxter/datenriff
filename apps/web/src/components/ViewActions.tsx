// Two things a reader wants once they have found a view: send it to someone,
// or get back out of it.
//
// Copy composes the link on demand rather than the address bar carrying it at
// all times — the camera lives in the fragment while you pan, and a full
// shareable link is assembled only when it is asked for.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtlasStore } from '../state/store';
import { useI18n } from '../i18n';
import { focusKey } from '../sculpture/focus';
import { shareUrl } from '../state/url';

export function ViewActions() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(() => {
    const s = useAtlasStore.getState();
    if (!s.view) return;
    const url = shareUrl(s.modeId, s.timeT, s.palette, s.view, focusKey(s.focus) || null);
    const done = () => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    };
    // clipboard access needs a secure context; on plain http the address bar
    // is the fallback, and it now holds everything but the mode's own query
    navigator.clipboard?.writeText(url).then(done, () => {
      window.history.replaceState(null, '', url);
      done();
    });
  }, []);

  // Back to the country, and out of any focused region: "reset" means the
  // view, not the reader's choice of mode or palette.
  const reset = useCallback(() => {
    const s = useAtlasStore.getState();
    s.setFocus(null);
    s.requestZoomStop(0);
  }, []);

  return (
    <>
      <button type="button" className="export__go" onClick={copy} title={t('ui.copyLinkHint')}>
        {copied ? t('ui.copied') : t('ui.copyLink')}
      </button>
      <button type="button" className="export__go" onClick={reset} title={t('ui.resetHint')}>
        {t('ui.reset')}
      </button>
    </>
  );
}
