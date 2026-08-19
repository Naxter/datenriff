import { useEffect, useMemo, useRef, useState } from 'react';
import { MODES, availableModes, modeFamilies } from '../modes/modes';
import { useAtlasStore } from '../state/store';

/** Two tiers: the families, then the modes of the open one. A flat row of
 *  every mode stopped being readable at about ten, and every dataset added
 *  makes it worse; a family absorbs new modes without growing the bar. */
export function ModeNav() {
  const modeId = useAtlasStore((s) => s.modeId);
  const setMode = useAtlasStore((s) => s.setMode);
  const manifest = useAtlasStore((s) => s.manifest);
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
    <nav className="modenav" aria-label="Sculpture modes">
      <div className="modenav__families">
        {families.map((family) => (
          <button
            key={family.id}
            type="button"
            className={`modenav__family${
              family.id === openFamily.id ? ' modenav__family--active' : ''
            }`}
            aria-pressed={family.id === openFamily.id}
            onPointerEnter={() => setPeeked(family.id)}
            onPointerLeave={() => setPeeked(null)}
            onFocus={() => setPeeked(family.id)}
            onBlur={() => setPeeked(null)}
            onClick={() => {
              const remembered = lastUsed.current.get(family.id);
              const target = family.modes.find((m) => m.id === remembered) ?? family.modes[0]!;
              setPeeked(null);
              setMode(target.id);
            }}
          >
            {family.label}
          </button>
        ))}
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
            {m.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
