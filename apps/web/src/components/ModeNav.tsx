import { MODES } from '../modes/modes';
import { useAtlasStore } from '../state/store';

export function ModeNav() {
  const modeId = useAtlasStore((s) => s.modeId);
  const setMode = useAtlasStore((s) => s.setMode);
  return (
    <nav className="modenav" aria-label="Sculpture modes">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`modenav__item${m.id === modeId ? ' modenav__item--active' : ''}`}
          aria-pressed={m.id === modeId}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </nav>
  );
}
