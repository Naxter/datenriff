// The camera rests on composed stops, never between them: each stop belongs
// to exactly one level of detail, framed and calibrated on purpose. These
// are the two questions the view asks of a stop list.

/** The stop closest to `zoom`. Returns `zoom` for an empty list. */
export function nearestStop(stops: readonly number[], zoom: number): number {
  let best = zoom;
  let bestGap = Infinity;
  for (const stop of stops) {
    const gap = Math.abs(stop - zoom);
    if (gap < bestGap) {
      bestGap = gap;
      best = stop;
    }
  }
  return best;
}

/** The next stop in `dir` (+1 closer, −1 further out), from any zoom —
 *  including one between stops, which a shared link or a focus flight can
 *  leave behind. Already at the end: stay there. `epsilon` keeps a stop the
 *  camera is sitting on from counting as "the next one". */
export function stepStop(
  stops: readonly number[],
  zoom: number,
  dir: 1 | -1,
  epsilon = 0.05,
): number {
  const sorted = [...stops].sort((a, b) => a - b);
  if (sorted.length === 0) return zoom;
  if (dir > 0) {
    for (const stop of sorted) if (stop > zoom + epsilon) return stop;
    return sorted[sorted.length - 1]!;
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const stop = sorted[i]!;
    if (stop < zoom - epsilon) return stop;
  }
  return sorted[0]!;
}
