import { LANGS, useI18n } from '../i18n';
import { useAtlasStore } from '../state/store';

/** DE | EN. Only the interface changes: place names, category names and the
 *  source credits keep the words their publishers use. */
export function LanguageSwitch() {
  const { lang, t } = useI18n();
  const setLang = useAtlasStore((s) => s.setLang);
  return (
    <div className="langswitch" role="group" aria-label={t('ui.language')}>
      {LANGS.flatMap((code, i) => [
        ...(i > 0
          ? [
              <span key={`${code}-sep`} className="langswitch__sep" aria-hidden="true">
                |
              </span>,
            ]
          : []),
        <button
          key={code}
          type="button"
          className={`langswitch__item${code === lang ? ' langswitch__item--active' : ''}`}
          aria-pressed={code === lang}
          lang={code}
          onClick={() => setLang(code)}
        >
          {code.toUpperCase()}
        </button>,
      ])}
    </div>
  );
}
