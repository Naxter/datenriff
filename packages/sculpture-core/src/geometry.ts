/** Average H3 edge lengths in metres, by resolution. */
export const H3_AVG_EDGE_METERS: Record<number, number> = {
  0: 1107712.6,
  1: 418676.0,
  2: 158244.7,
  3: 59810.9,
  4: 22606.4,
  5: 8544.4,
  6: 3229.5,
  7: 1220.6,
  8: 461.4,
  9: 174.4,
  10: 65.9,
  11: 24.9,
  12: 9.4,
};

/** Column radius for a hex cell; slight overlap closes gaps between the
 * disk approximations and reduces moiré. */
export function hexColumnRadius(resolution: number, overlap = 1.15): number {
  const edge = H3_AVG_EDGE_METERS[resolution];
  if (edge === undefined) {
    throw new Error(`No edge length known for resolution ${resolution}`);
  }
  return edge * overlap;
}
