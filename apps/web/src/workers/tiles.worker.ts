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

export interface TileLoadRequest {
  type: 'load';
  /** Echoed back; identifies tile, LOD and colouring generation. */
  key: string;
  positionsUrl: string;
  heightUrl: string;
  /** Colour source; omitted when equal to the height metric. */
  colorUrl?: string;
  colorStorage: 'f32' | 'u8';
  /** Derived change: colour = (b − a) / a from these two buffers. */
  changeUrls?: { a: string; b: string };
  saturationUrl?: string;
  elevationScale: number;
  colorScale: ColorScaleDefinition;
  colorStats: MetricStats;
  /** Ambient occlusion: neighbour radius in degrees, shade height, strength. */
  occlusion?: { radiusDeg: number; fullShadeMeters: number; strength: number };
}

export interface TileLoadResponse {
  type: 'tile';
  key: string;
  count: number;
  positions: Float32Array;
  heights: Float32Array;
  colors: Uint8Array;
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

async function load(req: TileLoadRequest): Promise<void> {
  const [positionsBuf, heightBuf] = await Promise.all([
    fetchBuffer(req.positionsUrl),
    fetchBuffer(req.heightUrl),
  ]);
  const positions = new Float32Array(positionsBuf);
  const heightValues = new Float32Array(heightBuf);
  const count = heightValues.length;

  const heights = computeElevations(heightValues, req.elevationScale);

  let colorValues: Float32Array | Uint8Array = heightValues;
  if (req.changeUrls) {
    const [a, b] = await Promise.all([
      fetchBuffer(req.changeUrls.a),
      fetchBuffer(req.changeUrls.b),
    ]);
    colorValues = buildChangePct(new Float32Array(b), new Float32Array(a));
  } else if (req.colorUrl) {
    const buf = await fetchBuffer(req.colorUrl);
    colorValues = req.colorStorage === 'u8' ? new Uint8Array(buf) : new Float32Array(buf);
  }

  let saturation: Uint8Array | undefined;
  if (req.saturationUrl) {
    saturation = new Uint8Array(await fetchBuffer(req.saturationUrl));
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

  scope.postMessage(
    { type: 'tile', key: req.key, count, positions, heights, colors },
    [positions.buffer, heights.buffer, colors.buffer],
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
