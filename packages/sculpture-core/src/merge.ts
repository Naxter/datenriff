/** Concatenating many small buffers into one, and finding the way back.
 *
 * The fine level of detail arrives as tiles of a few hundred cells each. Drawn
 * as one layer per tile that is dozens of draw calls per frame and a picking
 * pass per tile on every mouse move, for geometry that is identical apart from
 * its contents. Concatenated, it is one of each.
 *
 * The cost of that is an index that no longer means anything on its own: cell
 * 4,000 of the merged buffer belongs to some tile, at some offset inside it,
 * and the tooltip needs both to read the cell's values. `locateInMerged` is
 * that lookup, kept here because it is pure arithmetic and the one part of the
 * merge that can be silently wrong — an off-by-one reports a real value from
 * the wrong place, which looks plausible and is not.
 */

/** Start index of each part inside the concatenated buffer, ascending. */
export type PartOffsets = Int32Array | number[];

/**
 * Which part a merged index belongs to, and its index within that part.
 *
 * `offsets[i]` is where part `i` begins, so the answer is the last offset that
 * is not past `index`. Returns null for an index outside the buffer.
 */
export function locateInMerged(
  offsets: PartOffsets,
  total: number,
  index: number,
): { part: number; local: number } | null {
  if (!Number.isInteger(index) || index < 0 || index >= total) return null;
  const length = 'length' in offsets ? offsets.length : 0;
  if (length === 0) return null;
  let lo = 0;
  let hi = length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] as number) <= index) lo = mid;
    else hi = mid - 1;
  }
  const start = offsets[lo] as number;
  if (index < start) return null;
  return { part: lo, local: index - start };
}

/** Offsets for parts of the given lengths, and the total. */
export function mergeOffsets(lengths: readonly number[]): {
  offsets: Int32Array;
  total: number;
} {
  const offsets = new Int32Array(lengths.length);
  let at = 0;
  for (let i = 0; i < lengths.length; i++) {
    offsets[i] = at;
    at += lengths[i]!;
  }
  return { offsets, total: at };
}
