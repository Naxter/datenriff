// The standing links, centred under the sculpture: what this is, and the two
// pages German law requires to be reachable from every view. About opens the
// panel over the atlas; the legal pages are real documents and are navigated
// to, because they have to work when the app does not.

import { useAtlasStore } from '../state/store';
import { useI18n } from '../i18n';

export function PageLinks() {
  const setAboutOpen = useAtlasStore((s) => s.setAboutOpen);
  const aboutOpen = useAtlasStore((s) => s.aboutOpen);
  const { t, lang } = useI18n();
  const aboutHref = lang === 'de' ? '/ueber/' : '/about/';

  return (
    <nav className="pagelinks" aria-label={t('pages.aria')}>
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
      <span className="pagelinks__dot" aria-hidden="true">·</span>
      {/* a middle-click or a crawler still gets the real page */}
      <a className="pagelinks__link" href="/impressum/">
        {t('pages.imprint')}
      </a>
      <span className="pagelinks__dot" aria-hidden="true">·</span>
      <a className="pagelinks__link" href="/datenschutz/">
        {t('pages.privacy')}
      </a>
      <a className="pagelinks__hidden" href={aboutHref}>
        {t('pages.about')}
      </a>
    </nav>
  );
}
