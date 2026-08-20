// Where the camera is, and whether the detail for it has arrived.
//
// The camera rests on composed stops and flies between them, which reads as
// guided only if the reader can see which rung they are on. The active rung
// also carries the loading state: the fine cells stream in behind the coarse
// ones, and without a sign of that a reader steps on and misses the picture
// that was about to sharpen.

import { useAtlasStore } from '../state/store';
import { useI18n } from '../i18n';

/** Rung labels, coarsest first — the ladder is drawn the other way up. */
const RUNGS = ['country', 'region', 'city', 'district'] as const;

export function ZoomLadder() {
  const i18n = useI18n();
  const stops = useAtlasStore((s) => s.zoomStops);
  const index = useAtlasStore((s) => s.zoomStopIndex);
  const coverage = useAtlasStore((s) => s.detailCoverage);
  const request = useAtlasStore((s) => s.requestZoomStop);
  const introPhase = useAtlasStore((s) => s.introPhase);

  if (stops.length < 2 || introPhase !== null) return null;
  // detail is still on its way while the coarse cells are what is on screen
  const loading = coverage !== null && coverage < 1;

  return (
    <div className="ladder" aria-label={i18n.t('ladder.label')}>
      <ol className="ladder__rungs">
        {stops.map((_, i) => {
          const rung = RUNGS[Math.min(i, RUNGS.length - 1)]!;
          const active = i === index;
          return (
            // coarsest first in the DOM; the rail is turned around in CSS,
            // which is what lets a phone lay it out as a row instead
            <li key={rung} className={`ladder__item${active ? ' ladder__item--active' : ''}`}>
              <button
                type="button"
                className={`ladder__rung${active ? ' ladder__rung--active' : ''}`}
                aria-current={active ? 'true' : undefined}
                onClick={() => request(i)}
              >
                <span className="ladder__tick" aria-hidden="true" />
                <span className="ladder__name">{i18n.t(`ladder.${rung}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {/* The bar belongs to the active rung: it is that stop's detail that
          is still arriving. Hidden entirely where there is no finer level. */}
      <div className={`ladder__detail${loading ? ' ladder__detail--loading' : ''}`}>
        {loading && (
          <>
            <span className="ladder__detailBar" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.max(0.04, coverage)})` }} />
            </span>
            <span className="ladder__detailText">{i18n.t('ladder.sharpening')}</span>
          </>
        )}
      </div>
    </div>
  );
}
