// Cheap ambient occlusion for column fields.
//
// The editorial reference gets its crystalline look from light not reaching
// between dense needles: low cells surrounded by tall ones sit in shade,
// isolated spires stay bright. Ray tracing that per frame is out of the
// question, so occlusion is precomputed once per cell from the heights of
// its spatial neighbours and folded into the colour buffer.

/** Occlusion per cell in [0,1]; 0 = fully open, 1 = deep in a crevice. */
export function computeOcclusion(
  positions: Float32Array,
  heights: Float32Array,
  /** Neighbourhood radius in degrees of longitude (roughly one cell). */
  searchRadiusDeg: number,
  /** Height difference (metres) at which a neighbour fully occludes. */
  fullShadeMeters: number,
  out?: Float32Array,
): Float32Array {
  const count = heights.length;
  const result = out ?? new Float32Array(count);
  if (count === 0) return result;

  // uniform grid over the bounding box, one cell per search radius
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < count; i++) {
    const lon = positions[i * 2]!;
    const lat = positions[i * 2 + 1]!;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const cell = searchRadiusDeg > 0 ? searchRadiusDeg : 1e-6;
  const cols = Math.max(1, Math.ceil((maxLon - minLon) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxLat - minLat) / cell) + 1);
  const colOf = (lon: number) => Math.min(cols - 1, Math.floor((lon - minLon) / cell));
  const rowOf = (lat: number) => Math.min(rows - 1, Math.floor((lat - minLat) / cell));

  // counting sort into buckets: counts → offsets → fill
  const bucketCount = cols * rows;
  const starts = new Int32Array(bucketCount + 1);
  for (let i = 0; i < count; i++) {
    starts[rowOf(positions[i * 2 + 1]!) * cols + colOf(positions[i * 2]!) + 1]! += 1;
  }
  for (let b = 0; b < bucketCount; b++) starts[b + 1]! += starts[b]!;
  const items = new Int32Array(count);
  const cursor = Int32Array.from(starts.subarray(0, bucketCount));
  for (let i = 0; i < count; i++) {
    const b = rowOf(positions[i * 2 + 1]!) * cols + colOf(positions[i * 2]!);
    items[cursor[b]!++] = i;
  }

  for (let i = 0; i < count; i++) {
    const own = heights[i]!;
    const c = colOf(positions[i * 2]!);
    const r = rowOf(positions[i * 2 + 1]!);
    let taller = 0;
    let neighbours = 0;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= rows) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        if (cc < 0 || cc >= cols) continue;
        const b = rr * cols + cc;
        for (let k = starts[b]!; k < starts[b + 1]!; k++) {
          const j = items[k]!;
          if (j === i) continue;
          neighbours += 1;
          const rise = heights[j]! - own;
          if (rise > 0) {
            taller += rise > fullShadeMeters ? 1 : rise / fullShadeMeters;
          }
        }
      }
    }
    result[i] = neighbours > 0 ? taller / neighbours : 0;
  }
  return result;
}

/** Multiply an RGBA buffer in place by (1 − strength · occlusion). */
export function applyOcclusion(
  colors: Uint8Array,
  occlusion: Float32Array,
  strength: number,
): void {
  if (strength <= 0) return;
  for (let i = 0; i < occlusion.length; i++) {
    const shade = 1 - strength * occlusion[i]!;
    const o = i * 4;
    colors[o] = colors[o]! * shade;
    colors[o + 1] = colors[o + 1]! * shade;
    colors[o + 2] = colors[o + 2]! * shade;
  }
}
