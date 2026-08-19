import type { SculptureMode } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { useAtlasStore } from '../state/store';
import { useI18n } from '../i18n';
import { longDate } from '../i18n/format';

/** Mode title, and under it what the sculpture is made of. The data credit
 *  lives here since the wordmark took the centre: it is a licence condition
 *  for Destatis, NASA, BKG, DWD and the Bundesnetzagentur, so it is always
 *  on screen, never behind a control. */
export function Header({ mode, scene }: { mode: SculptureMode; scene: SceneData }) {
  // dims while another dataset streams in behind the current sculpture
  const loading = useAtlasStore((s) => s.sceneLoading);
  const focus = useAtlasStore((s) => s.focus);
  const i18n = useI18n();
  const text = i18n.mode(mode.id, { label: mode.label, subtitle: mode.subtitle });
  // While a dataset streams in the title already names the new mode, so the
  // credit has to name the new source too — otherwise RAIN stands over a
  // Destatis credit for as long as the load takes.
  const manifest = useAtlasStore((s) => s.manifest);
  const incoming = manifest?.datasets.find((d) => d.id === mode.dataset);
  const source = (loading && incoming ? incoming : scene.dataset).source;
  // the credit names the publisher in its own words; only the prefix is ours
  const sourceLabel = source.label.replace(/^Data:/, i18n.t('source.prefix'));
  const date = mode.attribution.referenceDate
    ? longDate(i18n.locale, mode.attribution.referenceDate)
    : undefined;
  return (
    <header className={`header${loading ? ' header--loading' : ''}`}>
      <h1 className="header__title">{text.label}</h1>
      <p className="header__subtitle">{text.subtitle}</p>
      {date && <p className="header__date">{date}</p>}
      <p className="header__source">
        {source.url ? (
          <a href={source.url} target="_blank" rel="noreferrer">
            {sourceLabel}
          </a>
        ) : (
          sourceLabel
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
