// Tile decode worker: fetches the binary buffers of one tile, computes
// calibrated elevations and mapped colours off the main thread, and posts
// the typed arrays back as transferables.

import type { ColorScaleDefinition, MetricStats } from '@datenriff/data-contracts';
import { applyColorScale } from '@datenriff/color-scales';
import {
  applyOcclusion,
  buildChangePct,
  computeElevations,
  computeOcclusion,
} from '@datenriff/sculpture-core';
import { applyFocus, focusMask, type FocusGeometry } from '../sculpture/focus';

export interface TileLoadRequest {
  type: 'load';
  /** Echoed back; identifies tile, LOD and colouring generation. */
  key: string;
  /** One-file pack with positions and every metric; when set, the *Url
   *  fields below only name the sections to read. */
  packUrl?: string;
  positionsUrl: string;
  heightUrl: string;
  /** Colour source; omitted when equal to the height metric. */
  colorUrl?: string;
  colorStorage: 'f32' | 'u8';
  /** Derived change: colour = (b − a) / a from these two buffers. */
  changeUrls?: { a: string; b: string };
  saturationUrl?: string;
  elevationScale: number;
  /** Value that stands on the plane (see HeightScaleDefinition.zeroAt). */
  zeroAt?: number;
  colorScale: ColorScaleDefinition;
  colorStats: MetricStats;
  /** Ambient occlusion: neighbour radius in degrees, shade height, strength. */
  occlusion?: { radiusDeg: number; fullShadeMeters: number; strength: number };
  /** Region in focus; cells outside step back (see sculpture/focus.ts). */
  focus?: FocusGeometry | null;
  /** Metric ids of the height and colour buffers, for the tooltip. */
  heightMetric: string;
  colorMetric: string;
}

export interface TileLoadResponse {
  type: 'tile';
  key: string;
  count: number;
  positions: Float32Array;
  heights: Float32Array;
  colors: Uint8Array;
  /** Raw metric values the tile was built from, by metric id, so the
   *  tooltip can read a fine cell instead of the country cell beneath. */
  values: Record<string, Float32Array | Uint8Array>;
}

export interface TileErrorResponse {
  type: 'error';
  key: string;
  message: string;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<TileLoadRequest>) => void) | null;
  postMessage(msg: TileLoadResponse | TileErrorResponse, transfer?: Transferable[]): void;
};

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return await res.arrayBuffer();
}

/** A tile pack (zensus_pipeline/pack.py): "DRTL", u32 version, u32 header
 *  length, JSON header with a section table, 4-byte-aligned payload. */
type Section = Float32Array | Uint8Array;

async function fetchPack(url: string): Promise<Map<string, Section>> {
  const buf = await fetchBuffer(url);
  const view = new DataView(buf);
  if (buf.byteLength < 12 || String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'DRTL') {
    throw new Error(`${url}: not a tile pack`);
  }
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`${url}: pack version ${version}`);
  const headerLen = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, headerLen))) as {
    count: number;
    sections: { name: string; dtype: 'f32' | 'u8'; size: number; offset: number; length: number }[];
  };
  const base = 12 + headerLen;
  const out = new Map<string, Section>();
  for (const s of header.sections) {
    // copies, so every section owns its buffer and can be transferred
    const bytes = buf.slice(base + s.offset, base + s.offset + s.length);
    out.set(s.name, s.dtype === 'f32' ? new Float32Array(bytes) : new Uint8Array(bytes));
  }
  return out;
}

/** "…/tiles/<tile>.<metric>.<storage>" → "<metric>" (a pack section name). */
const sectionOf = (url: string) => {
  const file = url.slice(url.lastIndexOf('/') + 1);
  const parts = file.split('.');
  return parts.slice(1, -1).join('.');
};

async function load(req: TileLoadRequest): Promise<void> {
  const pack = req.packUrl ? await fetchPack(req.packUrl) : null;
  const section = (url: string): Section => {
    const id = sectionOf(url);
    const s = pack!.get(id);
    if (!s) throw new Error(`${req.packUrl}: no section ${id}`);
    return s;
  };

  let positions: Float32Array;
  let heightValues: Float32Array;
  if (pack) {
    positions = pack.get('positions') as Float32Array;
    heightValues = section(req.heightUrl) as Float32Array;
  } else {
    const [positionsBuf, heightBuf] = await Promise.all([
      fetchBuffer(req.positionsUrl),
      fetchBuffer(req.heightUrl),
    ]);
    positions = new Float32Array(positionsBuf);
    heightValues = new Float32Array(heightBuf);
  }
  const count = heightValues.length;

  const heights = computeElevations(heightValues, req.elevationScale, undefined, req.zeroAt ?? 0);

  let colorValues: Float32Array | Uint8Array = heightValues;
  if (req.changeUrls) {
    let a: Float32Array;
    let b: Float32Array;
    if (pack) {
      a = section(req.changeUrls.a) as Float32Array;
      b = section(req.changeUrls.b) as Float32Array;
    } else {
      const [ab, bb] = await Promise.all([
        fetchBuffer(req.changeUrls.a),
        fetchBuffer(req.changeUrls.b),
      ]);
      a = new Float32Array(ab);
      b = new Float32Array(bb);
    }
    colorValues = buildChangePct(b, a);
  } else if (req.colorUrl) {
    if (pack) {
      colorValues = section(req.colorUrl);
    } else {
      const buf = await fetchBuffer(req.colorUrl);
      colorValues = req.colorStorage === 'u8' ? new Uint8Array(buf) : new Float32Array(buf);
    }
  }

  let saturation: Uint8Array | undefined;
  if (req.saturationUrl) {
    saturation = pack
      ? (section(req.saturationUrl) as Uint8Array)
      : new Uint8Array(await fetchBuffer(req.saturationUrl));
  }

  const colors = new Uint8Array(count * 4);
  applyColorScale(req.colorScale, colorValues, req.colorStats, colors, saturation);
  if (req.occlusion) {
    const occ = computeOcclusion(
      positions,
      heights,
      req.occlusion.radiusDeg,
      req.occlusion.fullShadeMeters,
    );
    applyOcclusion(colors, occ, req.occlusion.strength);
  }

  if (req.focus) applyFocus(heights, colors, focusMask(positions, req.focus));

  const values: Record<string, Float32Array | Uint8Array> = { [req.heightMetric]: heightValues };
  if (colorValues !== heightValues) values[req.colorMetric] = colorValues;
  if (pack) {
    // the pack carries every metric — the tooltip can read them all
    for (const [name, arr] of pack) if (name !== 'positions' && !(name in values)) values[name] = arr;
  }
  const transfer: Transferable[] = [positions.buffer, heights.buffer, colors.buffer];
  for (const arr of Object.values(values)) if (!transfer.includes(arr.buffer)) transfer.push(arr.buffer);
  scope.postMessage(
    { type: 'tile', key: req.key, count, positions, heights, colors, values },
    transfer,
  );
}

scope.onmessage = (e) => {
  const req = e.data;
  if (req.type !== 'load') return;
  load(req).catch((err: unknown) => {
    scope.postMessage({
      type: 'error',
      key: req.key,
      message: err instanceof Error ? err.message : String(err),
    });
  });
};
