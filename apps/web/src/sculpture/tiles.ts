// Viewport-driven loading of the tiled fine LODs. The worker decodes and
// colours tiles off the main thread; this manager decides which tiles the
// camera needs, keeps a small cache and exposes ready tiles to the view.

import { WebMercatorViewport, type MapViewState } from '@deck.gl/core';
import type {
  LonLatBounds,
  MetricStats,
  SculptureLOD,
  SculptureMode,
  TileIndex,
} from '@datenriff/data-contracts';
import { fineElevationScale, locateInMerged, mergeOffsets } from '@datenriff/sculpture-core';
import type { SceneData } from '../data/loader';
import { CHANGE_PCT_METRIC } from '../modes/modes';
import {
  OCCLUSION_STRENGTH,
  TARGET_MAX_HEIGHT_METERS,
  effectiveColorScale,
  heightIsCount,
  modeElevationScale,
} from './targets';
import { focusKey, type FocusGeometry } from './focus';
import type {
  TileErrorResponse,
  TileLoadRequest,
  TileLoadResponse,
} from '../workers/tiles.worker';

export interface ReadyTile {
  key: string;
  tileId: string;
  bounds: LonLatBounds;
  count: number;
  positions: Float32Array;
  heights: Float32Array;
  colors: Uint8Array;
  /** Raw metric values by id (height, colour / derived change). */
  values: Record<string, Float32Array | Uint8Array>;
}

/** Every visible tile concatenated into one set of buffers, so the view can
 *  draw them with a single layer. `offsets` maps a merged index back to the
 *  tile it came from, which is what the tooltip needs. */
export interface MergedTiles {
  count: number;
  positions: Float32Array;
  heights: Float32Array;
  colors: Uint8Array;
  /** Start index of each tile in the merged arrays, ascending. */
  offsets: Int32Array;
  tiles: ReadyTile[];
}

interface TileLodRuntime {
  lod: SculptureLOD;
  index: TileIndex | null;
}

export interface TileQuery {
  /** Ground region the fine tiles should cover (the near field of the
   *  pitched view, see `tileZone`); the far field stays with the country LOD. */
  zone: LonLatBounds;
  /** Camera target — tiles load nearest-first from here. */
  focus: [number, number];
  zoom: number;
  mode: SculptureMode;
  palette: string | null;
  /** Region in focus; tiles dim everything outside it like the country LOD. */
  region?: FocusGeometry | null;
  /** Timeline scrubbing keeps the country LOD in charge. */
  enabled: boolean;
  /** Where the country comes to rest in this window; the fine levels start
   *  above it rather than at an absolute zoom. */
  countryZoom?: number;
}

/** At most this many tiles kept in memory. */
const CACHE_CAP = 360;
/** At most this many tiles requested for one viewport. */
const REQUEST_CAP = 300;

/** Screen fraction (from the top) that stays with the country LOD. In the
 *  pitched view the upper part of the frame looks hundreds of kilometres
 *  out, where a fine cell is smaller than a pixel anyway. */
const FAR_FIELD_TOP = 0.35;
/** Zone half-extent cap around the focus, in screen widths. */
const ZONE_CAP = 1.4;
/** From this zoom on the zone is the whole frame (see tileZone). */
const DISTRICT_ZOOM = 10;
const ZONE_CAP_DISTRICT = 4;
/** Feather between fine tiles and country LOD, in screen widths. */
const ZONE_FEATHER = 0.12;

export function intersects(a: LonLatBounds, b: LonLatBounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export interface TileZone {
  /** Ground box the fine tiles should cover. */
  zone: LonLatBounds;
  /** Camera target, lon/lat. */
  focus: [number, number];
  /** Feather width in degrees, [lon, lat], for the country LOD's fade. */
  feather: [number, number];
}

/** Ground footprint of the near field of the frame: the lower part of the
 *  screen unprojected onto the plane, boxed, and clamped around the camera
 *  target so that a grazing angle cannot ask for half the country. The two
 *  corner unprojection used before produced a box that, under pitch and
 *  bearing, did not even contain the camera target — tiles then loaded
 *  around the wrong point while the country LOD had already faded out. */
export function tileZone(view: MapViewState, width: number, height: number): TileZone {
  const vp = new WebMercatorViewport({ ...view, width, height });
  // at district zoom the whole frame is a handful of tiles: cover it all,
  // or the country columns show through at the edges as translucent bells
  const district = view.zoom >= DISTRICT_ZOOM;
  const yCut = district ? 0 : height * FAR_FIELD_TOP;
  const corners = [
    [0, height],
    [width, height],
    [width, yCut],
    [0, yCut],
  ].map(([x, y]) => vp.unproject([x!, y!]) as [number, number]);
  const focus: [number, number] = [view.longitude, view.latitude];
  const span = (width * 360) / (512 * Math.pow(2, view.zoom));
  const kx = Math.cos((view.latitude * Math.PI) / 180);
  const cap = district ? ZONE_CAP_DISTRICT : ZONE_CAP;
  const capLon = cap * span;
  const capLat = cap * span * kx;
  const lons = corners.map((c) => c[0]).filter(Number.isFinite);
  const lats = corners.map((c) => c[1]).filter(Number.isFinite);
  const feather: [number, number] = [ZONE_FEATHER * span, ZONE_FEATHER * span * kx];
  // padded by two feathers: the country LOD fades over one of them, and
  // that margin — plus the width of a country column standing just outside
  // the frame — must lie beyond the frame's corners, not across them
  const pad: [number, number] = [feather[0] * 2, feather[1] * 2];
  const zone: LonLatBounds = [
    Math.max(Math.min(...lons, focus[0]) - pad[0], focus[0] - capLon),
    Math.max(Math.min(...lats, focus[1]) - pad[1], focus[1] - capLat),
    Math.min(Math.max(...lons, focus[0]) + pad[0], focus[0] + capLon),
    Math.min(Math.max(...lats, focus[1]) + pad[1], focus[1] + capLat),
  ];
  return { zone, focus, feather };
}

export class TileManager {
  private readonly lods: TileLodRuntime[];
  private readonly worker: Worker;
  private readonly ready = new Map<string, ReadyTile>();
  private readonly inFlight = new Set<string>();
  private readonly pendingBounds = new Map<string, LonLatBounds>();
  private readonly lastUsed = new Map<string, number>();
  private clock = 0;
  private currentGen = '';
  /** The generation before the current one (another LOD, mode, palette or
   *  focus). Its ready tiles stand in for current-generation tiles that
   *  have not arrived yet, so a switch replaces tiles one by one instead of
   *  dropping to the country LOD and back. */
  private previousGen = '';
  /** Keys wanted by the latest query, and the zone they should cover. */
  private needed = new Set<string>();
  /** Height scale per level and mode; see `heightScaleOf`. */
  private readonly heightScales = new Map<string, number>();
  private mergedCache: MergedTiles | null = null;
  private mergedKey = '';
  private zone: LonLatBounds | null = null;

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
    // Terminating stops the thread; it does not drop these handlers, and
    // both close over `this`, which holds the scene and every buffer in it.
    // A dataset switch made one of these per switch, so the old scenes were
    // still reachable and nothing was collected.
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.onChange = null;
    this.ready.clear();
    this.mergedCache = null;
    this.pendingBounds.clear();
    this.needed.clear();
    this.heightScales.clear();
    for (const entry of this.lods) entry.index = null;
  }

  /** The finest tiled LOD the current zoom qualifies for.
   *
   *  A level's minZoom is an absolute number tuned against a laptop, where
   *  the country comes to rest around zoom 5.9. On a 4K screen the country
   *  fits at 7.12 — past r9's 7.0 — so the *resting* view was already inside
   *  the fine level: 300 tile requests, the request cap, to draw the opening
   *  picture, and the poster composition replaced by fine detail before the
   *  reader had touched anything.
   *
   *  Detail belongs to zooming in, so the floor is relative to where the
   *  country rests. 0.6 is the same margin cameraStops() uses to decide a
   *  stop is far enough above the country to be worth having. */
  activeLod(zoom: number, countryZoom = -Infinity): SculptureLOD | null {
    let best: TileLodRuntime | null = null;
    for (const entry of this.lods) {
      const floor = Math.max(entry.lod.minZoom, countryZoom + 0.6);
      if (zoom >= floor && entry.index) {
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

  /** Ready tiles of the current generation that touch the current zone.
   *  Tiles left over from an earlier viewport stay cached but are not drawn:
   *  outside the zone the country LOD is showing, and both at once would
   *  stack the coarse column over the fine ones. */
  tiles(): ReadyTile[] {
    const result: ReadyTile[] = [];
    const currentIds = new Set<string>();
    for (const tile of this.ready.values()) {
      if (!tile.key.startsWith(this.currentGen)) continue;
      if (this.zone && !intersects(tile.bounds, this.zone)) continue;
      result.push(tile);
      currentIds.add(tile.tileId);
    }
    if (this.previousGen) {
      // tiles share ids across LODs (same parent), so an old tile steps
      // aside exactly when its replacement is ready
      for (const tile of this.ready.values()) {
        if (!tile.key.startsWith(this.previousGen)) continue;
        if (currentIds.has(tile.tileId)) continue;
        if (this.zone && !intersects(tile.bounds, this.zone)) continue;
        result.push(tile);
      }
    }
    return result;
  }

  /** The visible tiles as one buffer set, rebuilt only when the set itself
   *  changes. One layer per tile cost 71 draw calls a frame at city zoom,
   *  and 73 picking draws per mouse move, for tiles of a few hundred cells;
   *  concatenating is a memcpy of a megabyte or two per tile arrival. */
  merged(): MergedTiles | null {
    const tiles = this.tiles();
    if (tiles.length === 0) {
      this.mergedCache = null;
      this.mergedKey = '';
      return null;
    }
    const key = tiles.map((t) => t.key).join('|');
    if (this.mergedCache && this.mergedKey === key) return this.mergedCache;

    const { offsets, total: count } = mergeOffsets(tiles.map((t) => t.count));
    const positions = new Float32Array(count * 2);
    const heights = new Float32Array(count);
    const colors = new Uint8Array(count * 4);
    tiles.forEach((t, i) => {
      const at = offsets[i]!;
      positions.set(t.positions.subarray(0, t.count * 2), at * 2);
      heights.set(t.heights.subarray(0, t.count), at);
      colors.set(t.colors.subarray(0, t.count * 4), at * 4);
    });
    this.mergedKey = key;
    this.mergedCache = { count, positions, heights, colors, offsets, tiles };
    return this.mergedCache;
  }

  /** Which tile a merged index belongs to, and where inside it. The
   *  arithmetic lives in sculpture-core, where it is under test: an
   *  off-by-one here reports a real value from the wrong cell, which looks
   *  entirely plausible on screen. */
  static locate(merged: MergedTiles, index: number): { tile: ReadyTile; local: number } | null {
    const at = locateInMerged(merged.offsets, merged.count, index);
    const tile = at ? merged.tiles[at.part] : undefined;
    return tile && at ? { tile, local: at.local } : null;
  }

  /** Share of the tiles wanted for the current zone that have arrived — in
   *  the current generation or, standing in, the previous one. The view
   *  keeps the country LOD up until this is high — fading it out earlier
   *  leaves bare paper where tiles are still decoding. */
  coverage(): number {
    if (this.needed.size === 0) return 0;
    let have = 0;
    for (const key of this.needed) {
      if (this.ready.has(key)) {
        have += 1;
      } else if (this.previousGen) {
        const tileId = key.slice(key.lastIndexOf('|') + 1);
        if (this.ready.has(this.previousGen + tileId)) have += 1;
      }
    }
    return have / this.needed.size;
  }

  /** Once every wanted tile of the current generation is ready, the
   *  previous generation has nothing left to stand in for. */
  private retirePrevious(): void {
    if (!this.previousGen) return;
    for (const key of this.needed) if (!this.ready.has(key)) return;
    this.previousGen = '';
  }

  update(q: TileQuery): void {
    const lod = q.enabled ? this.activeLod(q.zoom, q.countryZoom) : null;
    if (!lod || !this.supportsMode(lod, q.mode)) return;
    const index = this.indexOf(lod);
    if (!index) return;

    const scale = effectiveColorScale(q.mode, q.palette);
    const gen = `${lod.resolution}|${q.mode.id}|${scale.palette}|${focusKey(q.region ?? null)}|`;
    if (gen !== this.currentGen) {
      if (this.currentGen) this.previousGen = this.currentGen;
      this.currentGen = gen;
    }
    this.zone = q.zone;

    // nearest to the camera target first: those are the columns that fill
    // the frame, the ones out at the zone edge are small on screen
    const [fx, fy] = q.focus;
    const kx = Math.cos((fy * Math.PI) / 180);
    const dist2 = (b: readonly number[]) => {
      const cx = ((b[0]! + b[2]!) / 2 - fx) * kx;
      const cy = (b[1]! + b[3]!) / 2 - fy;
      return cx * cx + cy * cy;
    };
    const wanted = index.tiles
      .filter((t) => intersects(t.bounds as LonLatBounds, q.zone))
      .sort((a, b) => dist2(a.bounds) - dist2(b.bounds))
      .slice(0, REQUEST_CAP);

    this.clock += 1;
    this.needed = new Set();
    for (const tile of wanted) {
      const key = this.currentGen + tile.id;
      this.needed.add(key);
      this.lastUsed.set(key, this.clock);
      // the stand-in stays fresh until its replacement lands
      if (this.previousGen && !this.ready.has(key)) {
        this.lastUsed.set(this.previousGen + tile.id, this.clock);
      }
      if (this.ready.has(key) || this.inFlight.has(key)) continue;
      this.request(lod, index, tile, key, q.mode, q.palette, q.region ?? null);
    }
    this.retirePrevious();
    this.evict();
    this.onChange?.(); // zone/needed changed even if no tile did
  }

  private indexOf(lod: SculptureLOD): TileIndex | null {
    return this.lods.find((e) => e.lod === lod)?.index ?? null;
  }

  /** Metres per unit of the height metric at a fine level.
   *
   *  Derived from the country calibration, not from this level's own
   *  quantiles: a count is redrawn per unit area, a mean, share or rate keeps
   *  the country scale. Calibrating each level against itself made the same
   *  place change height as the level changed under it — the ordinary cell
   *  rose six-fold on the way into r10 while the peaks came down.
   *
   *  One viewport asks for up to 300 tiles and the answer is the same for all
   *  of them, so it is worked out once per level and mode. */
  private heightScaleOf(
    lod: SculptureLOD,
    mode: SculptureMode,
    fallbackStats: MetricStats,
  ): number {
    const key = `${lod.resolution}|${mode.id}`;
    const cached = this.heightScales.get(key);
    if (cached !== undefined) return cached;
    const countryStats = this.scene.lod.metricStats?.[mode.heightMetric];
    const scale = countryStats
      ? fineElevationScale(
          modeElevationScale(mode, countryStats),
          this.scene.lod.cellRadiusMeters,
          lod.cellRadiusMeters,
          heightIsCount(this.scene, mode) ?? false,
        )
      : // no country stats for this metric: fall back to this level's own
        modeElevationScale(mode, fallbackStats);
    this.heightScales.set(key, scale);
    return scale;
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
    tile: TileIndex['tiles'][number],
    key: string,
    mode: SculptureMode,
    palette: string | null,
    focus: FocusGeometry | null,
  ): void {
    if (!lod.tileTemplate || !lod.positionsTemplate) return;
    const tileId = tile.id;
    this.pendingBounds.set(key, tile.bounds as LonLatBounds);
    const metricUrl = (metricId: string, storage: string) =>
      lod.tileTemplate!.replace('{tile}', tileId).replace(
        '{metric}',
        `${metricId}.${storage}`,
      );

    const heightStats = index.metrics[mode.heightMetric];
    if (!heightStats) return;
    const zeroAt = mode.heightScale.zeroAt ?? 0;
    const elevationScale = this.heightScaleOf(lod, mode, heightStats);

    const scale = effectiveColorScale(mode, palette);
    const isChange = mode.colorMetric === CHANGE_PCT_METRIC;
    const colorStorage: 'f32' | 'u8' = scale.type === 'categorical' ? 'u8' : 'f32';
    const colorStats: MetricStats = isChange
      ? { min: -1, max: 1, p50: 0, p95: 0.3, p995: 0.5 }
      : index.metrics[mode.colorMetric] ?? heightStats;

    const req: TileLoadRequest = {
      type: 'load',
      key,
      packUrl: lod.tilePackTemplate?.replace('{tile}', tileId),
      positionsUrl: lod.positionsTemplate.replace('{tile}', tileId),
      heightUrl: metricUrl(mode.heightMetric, 'f32'),
      elevationScale,
      zeroAt,
      colorScale: scale,
      colorStats,
      colorStorage,
      focus,
      heightMetric: mode.heightMetric,
      colorMetric: mode.colorMetric,
      // the neighbour search is the slow part of a tile decode; skip it
      // while occlusion is switched off
      occlusion:
        OCCLUSION_STRENGTH > 0
          ? {
              radiusDeg: (lod.cellRadiusMeters * 2.2) / 111_320,
              fullShadeMeters: TARGET_MAX_HEIGHT_METERS * 0.04,
              strength: OCCLUSION_STRENGTH,
            }
          : undefined,
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
    const bounds = this.pendingBounds.get(msg.key);
    this.pendingBounds.delete(msg.key);
    if (msg.type === 'error') {
      console.error(`tile ${msg.key}:`, msg.message);
      return;
    }
    // stale generation (mode/palette changed while loading) → drop; the
    // previous generation still lands, it stands in until replaced
    if (!bounds) return;
    if (!msg.key.startsWith(this.currentGen) && !(this.previousGen && msg.key.startsWith(this.previousGen))) {
      return;
    }
    const tileId = msg.key.slice(msg.key.lastIndexOf('|') + 1);
    this.ready.set(msg.key, {
      key: msg.key,
      tileId,
      bounds,
      count: msg.count,
      positions: msg.positions,
      heights: msg.heights,
      colors: msg.colors,
      values: msg.values,
    });
    this.lastUsed.set(msg.key, this.clock);
    this.retirePrevious();
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
