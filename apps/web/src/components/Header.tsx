import type { SculptureMode } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { useAtlasStore } from '../state/store';
import { useI18n } from '../i18n';
import { longDate } from '../i18n/format';
import { licenceRef, type LicenceRef } from '../data/licences';

/** BKG asks for the source note itself to carry this link. */
const BKG_URL = 'https://www.bkg.bund.de';

/** One source note: who provided the data, under which licence, that it was
 *  changed, and where the dataset lives.
 *
 *  DL-DE-BY-2.0 §2 wants all three of the provider's own designation, the
 *  licence annotation with a link to its text, and a link to the dataset
 *  (URI); §3 wants the note that the data were changed. CC BY 4.0 §3(a)
 *  asks for the same shape. BKG's terms add that the word "BKG" in the note
 *  must link to bkg.bund.de — which is a different target from the dataset
 *  URI, so those sources carry `providerUrl` and the URI gets a segment of
 *  its own. */
function SourceNote({
  prefix,
  label,
  href,
  providerUrl,
  datasetName,
  licence,
  sourcesUrl,
  extra,
}: {
  prefix?: string;
  label: string;
  href?: string;
  providerUrl?: string;
  datasetName?: string;
  licence: LicenceRef | null;
  sourcesUrl?: string;
  extra?: boolean;
}) {
  const i18n = useI18n();
  // With a provider link the name points at the provider and the dataset
  // takes its own segment; without one the name is the dataset link.
  const nameHref = providerUrl ?? href;
  const uriSegment = providerUrl && href ? (datasetName ?? i18n.t('source.dataset')) : null;
  return (
    <p className={`header__source${extra ? ' header__source--extra' : ''}`}>
      {prefix ? `${prefix.replace(/:\s*$/, '')}: ` : ''}
      {nameHref ? (
        <a href={nameHref} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        label
      )}
      {licence && (
        <>
          {' · '}
          <a className="header__licence" href={licence.url} target="_blank" rel="noreferrer">
            {licence.short}
          </a>
        </>
      )}
      {' · '}
      {i18n.t('source.modified')}
      {uriSegment && (
        <>
          {' · '}
          <a href={href} target="_blank" rel="noreferrer">
            {uriSegment}
          </a>
        </>
      )}
      {sourcesUrl && (
        <>
          {' · '}
          <a href={sourcesUrl} target="_blank" rel="noreferrer">
            {i18n.t('source.dataSources')}
          </a>
        </>
      )}
    </p>
  );
}

/** Mode title, and under it what the sculpture is made of. The data credit
 *  lives here since the wordmark took the centre: it is a licence condition
 *  for Destatis, NASA, BKG, DWD and the Bundesnetzagentur, so it is always
 *  on screen, never behind a control. */
export function Header({ mode, scene }: { mode: SculptureMode; scene: SceneData }) {
  // dims while another dataset streams in behind the current sculpture
  const loading = useAtlasStore((s) => s.sceneLoading);
  const i18n = useI18n();
  const text = i18n.mode(mode.id, { label: mode.label, subtitle: mode.subtitle });
  // While a dataset streams in the title already names the new mode, so the
  // credit has to name the new source too — otherwise RAIN stands over a
  // Destatis credit for as long as the load takes.
  const manifest = useAtlasStore((s) => s.manifest);
  const incoming = manifest?.datasets.find((d) => d.id === mode.dataset);
  const source = (loading && incoming ? incoming : scene.dataset).source;
  // the credit names the publisher in its own words; only the prefix is ours
  const sourceLabel = source.label.replace(/^Data:\s*/, '');
  const licence = licenceRef(source.license);
  // The country ring every raster pipeline is clipped to is simplified from
  // VG2500, so BKG geometry shapes what is drawn in every mode — the credit
  // is owed always, not only where a border is on screen.
  const bkg = useAtlasStore((s) => s.bkgCredit);
  const bkgLicence = licenceRef(bkg?.license);
  const date = mode.attribution.referenceDate
    ? longDate(i18n.locale, mode.attribution.referenceDate)
    : undefined;
  return (
    <header className={`header${loading ? ' header--loading' : ''}`}>
      <h1 className="header__title">{text.label}</h1>
      <p className="header__subtitle">{text.subtitle}</p>
      {date && <p className="header__date">{date}</p>}
      <SourceNote
        prefix={i18n.t('source.prefix')}
        label={sourceLabel}
        href={source.url}
        providerUrl={source.providerUrl}
        datasetName={source.datasetName}
        licence={licence}
      />
      {bkg && (
        <SourceNote
          extra
          prefix={i18n.t('source.boundaries')}
          label={bkg.attribution}
          href={bkg.url}
          providerUrl={BKG_URL}
          datasetName="VG2500"
          licence={bkgLicence}
          sourcesUrl={bkg.sourcesUrl}
        />
      )}
    </header>
  );
}
