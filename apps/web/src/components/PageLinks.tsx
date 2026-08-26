// The standing links, centred under the sculpture: what this is, and the two
// pages German law requires to be reachable from every view. About opens the
// panel over the atlas; the legal pages are real documents and are navigated
// to, because they have to work when the app does not. On a phone About is
// a page too — see below.

import { useAtlasStore } from '../state/store';
import { usePhoneLayout } from '../layout';
import { useI18n } from '../i18n';

export function PageLinks() {
  const setAboutOpen = useAtlasStore((s) => s.setAboutOpen);
  const aboutOpen = useAtlasStore((s) => s.aboutOpen);
  const { t, lang } = useI18n();
  const aboutHref = lang === 'de' ? '/ueber/' : '/about/';

  // On a phone About is the page, not the panel.
  //
  // The panel is a reading surface laid over a living atlas: each section
  // flies the camera somewhere and switches the mode behind it, so the prose
  // about rainfall is read against the rainfall. None of that survives a
  // narrow screen — the sheet covers the sculpture it is talking about, and
  // the camera is fixed here anyway. The static page is the better version of
  // the same words: it is already built, it is plain text, and it scrolls.
  const onPhone = usePhoneLayout();

  return (
    <nav className="pagelinks" aria-label={t('pages.aria')}>
      {onPhone ? (
        <a className="pagelinks__link" href={aboutHref}>
          {t('pages.about')}
        </a>
      ) : (
        <button
          type="button"
          className="pagelinks__link"
          onClick={() => setAboutOpen(!aboutOpen)}
          aria-haspopup="dialog"
          aria-expanded={aboutOpen}
          title={`${t('pages.about')} (A)`}
        >
          {t('pages.about')}
        </button>
      )}
      <span className="pagelinks__dot" aria-hidden="true">·</span>
      {/* a middle-click or a crawler still gets the real page */}
      <a className="pagelinks__link" href="/impressum/">
        {t('pages.imprint')}
      </a>
      <span className="pagelinks__dot" aria-hidden="true">·</span>
      <a className="pagelinks__link" href="/datenschutz/">
        {t('pages.privacy')}
      </a>
      {/* the crawlable twin of the About button: a real href for indexers,
          hidden from assistive technology so the link is not announced twice */}
      <a className="pagelinks__hidden" href={aboutHref} tabIndex={-1} aria-hidden="true">
        {t('pages.about')}
      </a>
    </nav>
  );
}
