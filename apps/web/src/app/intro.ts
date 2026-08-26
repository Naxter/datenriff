// Opening sequence: a plain visit does not start with a menu.
// The title stands on empty paper, Germany rises out of the plane beneath
// it, a tagline follows, then the UI comes in. Deep links, repeat visits in
// the same session and reduced-motion users go straight to the sculpture.

import { isPhoneLayout } from '../layout';
import { readUrlState } from '../state/url';
import { useAtlasStore, type IntroPhase } from '../state/store';
import { launchParams } from '../state/url';

const SEEN_KEY = 'datenriff:intro-seen';

/** ms after the scene is ready at which each phase begins. */
export const INTRO_REVEAL_AT = 1100;
export const INTRO_DONE_AT = 5200;
/** Growth duration while the title is still up. */
export const INTRO_GROWTH_MS = 2600;

export const INTRO_TAGLINE = '83 million people, mapped as a landscape.';

/** Decide once, before the first scene renders. `?intro=1` forces it (for
 *  checking the staging), `?intro=0` skips it. */
export function introEligible(reducedMotion: boolean): boolean {
  const params = launchParams();
  const forced = params.get('intro');
  if (forced === '1') return true;
  if (forced === '0' || reducedMotion) return false;
  // Not on a phone. The sequence holds the title over the sculpture for five
  // seconds with the interface faded out and `pointer-events: none` on it —
  // which on a narrow screen means the mode nav is visible, unreadable
  // through the title laid over it, and dead to the touch. On a wide screen
  // there is room for the staging; here it only reads as a broken page.
  if (isPhoneLayout()) return false;
  const url = readUrlState();
  if (url.modeId || url.view || url.palette || url.timeT !== undefined) return false;
  try {
    return sessionStorage.getItem(SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // private mode etc. — the intro simply plays again next time
  }
}

/** Runs the phase timers from 'title' to 'done'; any click or key skips
 *  ahead. Returns the cleanup for the calling effect. */
export function runIntro(setPhase: (p: IntroPhase) => void): () => void {
  markSeen();
  const timers = [
    setTimeout(() => setPhase('reveal'), INTRO_REVEAL_AT),
    setTimeout(() => setPhase('done'), INTRO_DONE_AT),
  ];
  const skip = () => {
    if (useAtlasStore.getState().introPhase === 'done') return;
    timers.forEach(clearTimeout);
    setPhase('done');
  };
  window.addEventListener('pointerdown', skip);
  window.addEventListener('keydown', skip);
  window.addEventListener('wheel', skip, { passive: true });
  return () => {
    timers.forEach(clearTimeout);
    window.removeEventListener('pointerdown', skip);
    window.removeEventListener('keydown', skip);
    window.removeEventListener('wheel', skip);
  };
}
