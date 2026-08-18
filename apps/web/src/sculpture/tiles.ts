// Viewport-driven loading of the tiled fine LODs. The worker decodes and
// colours tiles off the main thread; this manager decides which tiles the
// camera needs, keeps a small cache and exposes ready tiles to the view.

import type {
  LonLatBounds,
  MetricStats,
  SculptureLOD,
  SculptureMode,
  TileIndex,
} from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { CHANGE_PCT_METRIC } from '../modes/modes';
import {
  OCCLUSION_STRENGTH,
  PEAKEDNESS,
  TARGET_MAX_HEIGHT_METERS,
  effectiveColorScale,
} from './targets';
import type {
  TileErrorResponse,
  TileLoadRequest,
  TileLoadResponse,
} from '../workers/tiles.worker';

export interface ReadyTile {
  key: string;
  tileId: string;
  count: number;
  positions: Float32Array;
  heights: Float32Array;
  colors: Uint8Array;
}

interface TileLodRuntime {
  lod: SculptureLOD;
  index: TileIndex | null;
}

export interface TileQuery {
  bounds: LonLatBounds;
  zoom: number;
  mode: SculptureMode;
  palette: string | null;
  /** Timeline scrubbing keeps the country LOD in charge. */
  enabled: boolean;
}

/** Prefetch margin around the viewport, as a fraction of its span. */
const EXPAND = 0.25;
/** At most this many tiles kept in memory. */
const CACHE_CAP = 320;
/** At most this many tiles requested for one viewport. */
const REQUEST_CAP = 280;

function intersects(a: LonLatBounds, b: LonLatBounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function expand(b: LonLatBounds, f: number): LonLatBounds {
  const dx = (b[2] - b[0]) * f;
  const dy = (b[3] - b[1]) * f;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
}

export class TileManager {
  private readonly lods: TileLodRuntime[];
  private readonly worker: Worker;
  private readonly ready = new Map<string, ReadyTile>();
  private readonly inFlight = new Set<string>();
  private readonly lastUsed = new Map<string, number>();
  private clock = 0;
  private currentGen = '';

  /** Bumped state for the view; called whenever ready tiles change. */
  onChange: (() => void) | null = null;

  constructor(private readonly scene: SceneData) {
    this.lods = scene.tileLods.map((lod) => ({ lod, index: null }));
    this.worker = new Worker(new URL('../workers/tiles.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (
      e: MessageEvent<TileLoadResponse | TileErrorResponse>,
    ) => this.onMessage(e.data);
    this.worker.onerror = (e) => console.error('tile worker:', e.message);
    for (const entry of this.lods) void this.fetchIndex(entry);
  }

  destroy(): void {
    this.worker.terminate();
    this.ready.clear();
  }

  /** The finest tiled LOD the current zoom qualifies for. */
  activeLod(zoom: number): SculptureLOD | null {
    let best: TileLodRuntime | null = null;
    for (const entry of this.lods) {
      if (zoom >= entry.lod.minZoom && entry.index) {
        if (!best || entry.lod.resolution > best.lod.resolution) best = entry;
      }
    }
    return best?.lod ?? null;
  }

  /** Does this LOD carry the metrics the mode needs? */
  supportsMode(lod: SculptureLOD, mode: SculptureMode): boolean {
    const index = this.indexOf(lod);
    if (!index) return false;
    const has = (id: string) => id in index.metrics;
    if (!has(mode.heightMetric)) return false;
    if (mode.colorMetric === CHANGE_PCT_METRIC) {
      return has('population_2022') && has('population_2011');
    }
    if (!has(mode.colorMetric)) return false;
    const scale = mode.colorScale;
    if (scale.type === 'categorical' && scale.saturationMetric) {
      return has(scale.saturationMetric);
    }
    return true;
  }

  /** Ready tiles of the current generation, for the active LOD. */
  tiles(): ReadyTile[] {
    const result: ReadyTile[] = [];
    for (const tile of this.ready.values()) {
      if (tile.key.startsWith(this.currentGen)) result.push(tile);
    }
    return result;
  }

  update(q: TileQuery): void {
    const lod = q.enabled ? this.activeLod(q.zoom) : null;
    if (!lod || !this.supportsMode(lod, q.mode)) return;
    const index = this.indexOf(lod);
    if (!index) return;

    const scale = effectiveColorScale(q.mode, q.palette);
    this.currentGen = `${lod.resolution}|${q.mode.id}|${scale.palette}|`;

    const view = expand(q.bounds, EXPAND);
    const cx = (q.bounds[0] + q.bounds[2]) / 2;
    const cy = (q.bounds[1] + q.bounds[3]) / 2;
    const needed = index.tiles
      .filter((t) => intersects(t.bounds as LonLatBounds, view))
      .sort((a, b) => {
        const da = (a.bounds[0] - cx) ** 2 + (a.bounds[1] - cy) ** 2;
        const db = (b.bounds[0] - cx) ** 2 + (b.bounds[1] - cy) ** 2;
        return da - db;
      })
      .slice(0, REQUEST_CAP);

    this.clock += 1;
    for (const tile of needed) {
      const key = this.currentGen + tile.id;
      this.lastUsed.set(key, this.clock);
      if (this.ready.has(key) || this.inFlight.has(key)) continue;
      this.request(lod, index, tile.id, key, q.mode, q.palette);
    }
    this.evict();
  }

  private indexOf(lod: SculptureLOD): TileIndex | null {
    return this.lods.find((e) => e.lod === lod)?.index ?? null;
  }

  private async fetchIndex(entry: TileLodRuntime): Promise<void> {
    if (!entry.lod.tileIndex) return;
    try {
      const res = await fetch(entry.lod.tileIndex);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      entry.index = (await res.json()) as TileIndex;
      this.onChange?.();
    } catch (e) {
      console.error(`tile index ${entry.lod.tileIndex}:`, e);
    }
  }

  private request(
    lod: SculptureLOD,
    index: TileIndex,
    tileId: string,
    key: string,
    mode: SculptureMode,
    palette: string | null,
  ): void {
    if (!lod.tileTemplate || !lod.positionsTemplate) return;
    const metricUrl = (metricId: string, storage: string) =>
      lod.tileTemplate!.replace('{tile}', tileId).replace(
        '{metric}',
        `${metricId}.${storage}`,
      );

    const heightStats = index.metrics[mode.heightMetric];
    if (!heightStats) return;
    // same anchor blend as the country LOD, but against this LOD's own stats
    const anchor = heightStats.p995 || 1;
    const top = heightStats.max > 0 ? heightStats.max : anchor;
    const elevationScale =
      TARGET_MAX_HEIGHT_METERS / (anchor * Math.pow(top / anchor, PEAKEDNESS));

    const scale = effectiveColorScale(mode, palette);
    const isChange = mode.colorMetric === CHANGE_PCT_METRIC;
    const colorStorage: 'f32' | 'u8' = scale.type === 'categorical' ? 'u8' : 'f32';
    const colorStats: MetricStats = isChange
      ? { min: -1, max: 1, p50: 0, p95: 0.3, p995: 0.5 }
      : index.metrics[mode.colorMetric] ?? heightStats;

    const req: TileLoadRequest = {
      type: 'load',
      key,
      positionsUrl: lod.positionsTemplate.replace('{tile}', tileId),
      heightUrl: metricUrl(mode.heightMetric, 'f32'),
      elevationScale,
      colorScale: scale,
      colorStats,
      colorStorage,
      occlusion: {
        radiusDeg: (lod.cellRadiusMeters * 2.2) / 111_320,
        fullShadeMeters: TARGET_MAX_HEIGHT_METERS * 0.04,
        strength: OCCLUSION_STRENGTH,
      },
    };
    if (isChange) {
      req.changeUrls = {
        a: metricUrl('population_2011', 'f32'),
        b: metricUrl('population_2022', 'f32'),
      };
    } else if (mode.colorMetric !== mode.heightMetric) {
      req.colorUrl = metricUrl(mode.colorMetric, colorStorage);
    }
    if (scale.type === 'categorical' && scale.saturationMetric) {
      req.saturationUrl = metricUrl(scale.saturationMetric, 'u8');
    }

    this.inFlight.add(key);
    this.worker.postMessage(req);
  }

  private onMessage(msg: TileLoadResponse | TileErrorResponse): void {
    this.inFlight.delete(msg.key);
    if (msg.type === 'error') {
      console.error(`tile ${msg.key}:`, msg.message);
      return;
    }
    // stale generation (mode/palette changed while loading) → drop
    if (!msg.key.startsWith(this.currentGen)) return;
    const tileId = msg.key.slice(msg.key.lastIndexOf('|') + 1);
    this.ready.set(msg.key, {
      key: msg.key,
      tileId,
      count: msg.count,
      positions: msg.positions,
      heights: msg.heights,
      colors: msg.colors,
    });
    this.lastUsed.set(msg.key, this.clock);
    this.onChange?.();
  }

  private evict(): void {
    if (this.ready.size <= CACHE_CAP) return;
    const byAge = [...this.ready.keys()].sort(
      (a, b) => (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0),
    );
    for (const key of byAge.slice(0, this.ready.size - CACHE_CAP)) {
      this.ready.delete(key);
      this.lastUsed.delete(key);
    }
  }
}
