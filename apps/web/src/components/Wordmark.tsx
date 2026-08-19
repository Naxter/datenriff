/** The masthead: the tool's name, centred above the plate.
 *
 *  The sub-line is tracked to span the same width as the name, which is
 *  what makes the two read as one mark rather than two stacked labels.
 *  Wide tracking adds space after the final letter, so both lines carry a
 *  matching indent or they sit visibly off-centre. */
export function Wordmark() {
  return (
    <div className="wordmark" aria-label="Datenriff — Vertical Atlas of Germany">
      <div className="wordmark__name">Datenriff</div>
      <div className="wordmark__sub">Vertical Atlas — Germany</div>
    </div>
  );
}
