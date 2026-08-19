import type { SculptureMode } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { useAtlasStore } from '../state/store';

/** Mode title, and under it what the sculpture is made of. The data credit
 *  lives here since the wordmark took the centre: it is a licence condition
 *  for Destatis, NASA, BKG, DWD and the Bundesnetzagentur, so it is always
 *  on screen, never behind a control. */
export function Header({ mode, scene }: { mode: SculptureMode; scene: SceneData }) {
  // dims while another dataset streams in behind the current sculpture
  const loading = useAtlasStore((s) => s.sceneLoading);
  const focus = useAtlasStore((s) => s.focus);
  const source = scene.dataset.source;
  const date = mode.attribution.referenceDate
    ? new Date(mode.attribution.referenceDate).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : undefined;
  return (
    <header className={`header${loading ? ' header--loading' : ''}`}>
      <h1 className="header__title">{mode.label}</h1>
      <p className="header__subtitle">{mode.subtitle}</p>
      {date && <p className="header__date">{date}</p>}
      <p className="header__source">
        {source.url ? (
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.label}
          </a>
        ) : (
          source.label
        )}
      </p>
      {focus?.kind === 'state' && (
        <p className="header__source header__source--extra">
          Boundaries: © GeoBasis-DE / BKG · DL-DE-BY-2.0
        </p>
      )}
    </header>
  );
}
