import { useEffect, useMemo, useRef, useState } from 'react';
import { MODES, availableModes, modeFamilies } from '../modes/modes';
import { useAtlasStore } from '../state/store';
import { useI18n } from '../i18n';
import type { SceneData } from '../data/loader';
import { FocusButton } from './FocusButton';

/** Two tiers: the families, then the modes of the open one. A flat row of
 *  every mode stopped being readable at about ten, and every dataset added
 *  makes it worse; a family absorbs new modes without growing the bar. */
export function ModeNav({ scene }: { scene?: SceneData }) {
  const modeId = useAtlasStore((s) => s.modeId);
  const setMode = useAtlasStore((s) => s.setMode);
  const manifest = useAtlasStore((s) => s.manifest);
  const i18n = useI18n();
  const modes = useMemo(
    () => (manifest ? availableModes(manifest.datasets) : MODES),
    [manifest],
  );
  const families = useMemo(() => modeFamilies(modes), [modes]);
  const openFamily =
    families.find((f) => f.modes.some((m) => m.id === modeId)) ?? families[0];

  // coming back to a family returns you to where you left it
  const lastUsed = useRef(new Map<string, string>());
  useEffect(() => {
    if (openFamily) lastUsed.current.set(openFamily.id, modeId);
  }, [openFamily, modeId]);

  // the tier the pointer is over, so a family can be read before choosing
  const [peeked, setPeeked] = useState<string | null>(null);
  const shown = families.find((f) => f.id === peeked) ?? openFamily;
  if (!openFamily || !shown) return null;

  return (
    <nav className="modenav" aria-label={i18n.t('ui.modes')}>
      <div className="modenav__families">
        {families.map((family) => (
          <button
            key={family.id}
            type="button"
            className={`modenav__family${
              family.id === openFamily.id ? ' modenav__family--active' : ''
            }`}
            aria-pressed={family.id === openFamily.id}
            // Peeking is a mouse affordance. On a touchscreen a tap fires
            // pointerenter first, the browser treats that as the hover half
            // of the gesture, and the tap that was meant to switch families
            // only previews one — so it took two taps to change anything.
            onPointerEnter={(e) => e.pointerType === 'mouse' && setPeeked(family.id)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setPeeked(null)}
            onFocus={(e) => {
              // keyboard only: a tap also focuses, and that would peek again
              if (e.currentTarget.matches(':focus-visible')) setPeeked(family.id);
            }}
            onBlur={() => setPeeked(null)}
            onClick={() => {
              const remembered = lastUsed.current.get(family.id);
              const target = family.modes.find((m) => m.id === remembered) ?? family.modes[0]!;
              setPeeked(null);
              setMode(target.id);
            }}
          >
            {i18n.t(`family.${family.id}`)}
          </button>
        ))}
        {/* what you are looking at, spatially — the same kind of control as
            a family, so it sits with them rather than among the tools */}
        {scene && <FocusButton scene={scene} />}
      </div>
      <div className="modenav__modes">
        {shown.modes.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`modenav__item${m.id === modeId ? ' modenav__item--active' : ''}`}
            aria-pressed={m.id === modeId}
            onClick={() => {
              setPeeked(null);
              setMode(m.id);
            }}
          >
            {i18n.mode(m.id, { label: m.label }).label}
          </button>
        ))}
      </div>
    </nav>
  );
}
