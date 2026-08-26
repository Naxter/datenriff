// The one definition of "phone".
//
// Below this breakpoint the interface stacks into a column, the camera is
// fixed, the intro is skipped and About is a page instead of a panel. The
// decision used to be made independently at five call sites, each with its
// own matchMedia boilerplate — the exact setup for the bug where one test
// disagreed with the stylesheet and crashed the fit on a portrait tablet.
//
// CSS cannot read a constant: the `@media (max-width: 760px)` blocks in
// design/global.css state the same number and must change with this one.

import { useEffect, useState } from 'react';

export const PHONE_QUERY = '(max-width: 760px)';

/** Does the phone layout apply right now? False where matchMedia is absent. */
export function isPhoneLayout(): boolean {
  return window.matchMedia?.(PHONE_QUERY).matches ?? false;
}

/** `isPhoneLayout` as state, updated when the viewport crosses the breakpoint. */
export function usePhoneLayout(): boolean {
  const [onPhone, setOnPhone] = useState(isPhoneLayout);
  useEffect(() => {
    const query = window.matchMedia?.(PHONE_QUERY);
    if (!query) return;
    const onChange = () => setOnPhone(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return onPhone;
}
