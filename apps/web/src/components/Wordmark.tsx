import { useAtlasStore } from '../state/store';

/** The masthead: the tool's name, centred above the plate.
 *
 *  The sub-line is tracked to span the same width as the name, which is
 *  what makes the two read as one mark rather than two stacked labels.
 *  Wide tracking adds space after the final letter, so both lines carry a
 *  matching indent or they sit visibly off-centre.
 *
 *  While a dataset streams in, a hairline under the mark fills up. It is
 *  the only loading affordance the page has, and it is a real count of the
 *  buffers rather than a spinner. */
export function Wordmark() {
  const loading = useAtlasStore((s) => s.sceneLoading);
  const progress = useAtlasStore((s) => s.sceneProgress);
  return (
    <div className="wordmark" aria-label="Datenriff — Vertical Atlas of Germany">
      <div className="wordmark__name">Datenriff</div>
      <div className="wordmark__sub">Vertical Atlas — Germany</div>
      <div
        className={`wordmark__progress${loading ? ' wordmark__progress--on' : ''}`}
        role="progressbar"
        aria-hidden={!loading}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span style={{ transform: `scaleX(${loading ? progress : 0})` }} />
      </div>
    </div>
  );
}
