import { INTRO_TAGLINE } from '../app/intro';
import { useI18n } from '../i18n';
import type { IntroPhase } from '../state/store';

/** Loading veil and, on a plain visit, the opening title: the same mark
 *  stays put while the paper behind it clears and the sculpture rises. */
export function Veil({
  visible,
  intro,
  error,
}: {
  visible: boolean;
  intro: IntroPhase | null;
  error?: string;
}) {
  const { t } = useI18n();
  const cls = visible
    ? 'veil'
    : intro
      ? `veil veil--intro${intro === 'reveal' ? ' veil--reveal' : ''}`
      : 'veil veil--hidden';
  return (
    <div className={cls} aria-hidden={!visible && !intro}>
      <div className="veil__mark">
        <h1 className="veil__title">{t('intro.title')}</h1>
        <p className="veil__sub">{t('intro.sub')}</p>
        <p className="veil__tagline">{INTRO_TAGLINE}</p>
        {error && <p className="veil__error">{error}</p>}
      </div>
    </div>
  );
}
