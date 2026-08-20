// Everything the country view needs is static: one JSON manifest plus raw
// little-endian typed-array buffers, fetched in parallel and handed to the
// GPU untouched. Worker-based decode comes with the tiled LODs.

import type {
  AtlasManifest,
  CityLabel,
  SculptureDataset,
  SculptureLOD,
  MetricDefinition,
  SculptureMode,
} from '@datenriff/data-contracts';
import { pickCountryLod, type QualityProfile } from '../sculpture/quality';

export interface SceneData {
  manifest: AtlasManifest;
  dataset: SculptureDataset;
  lod: SculptureLOD;
  /** Quality profile the country LOD was chosen for. */
  profileId: QualityProfile['id'];
  /** Tiled fine LODs, loaded viewport-driven by the TileManager. */
  tileLods: SculptureLOD[];
  count: number;
  positions: Float32Array;
  metrics: Map<string, Float32Array | Uint8Array>;
  cities: CityLabel[];
  boundary: [number, number][][];
  /** Metric ids not fetched yet. The opening mode's buffers arrive before
   *  the first frame; the rest of the dataset follows behind it. */
  pending: Set<string>;
  /** Resolves once every listed metric is in `metrics`. Cheap and safe to
   *  call for metrics that already landed. */
  ensure(ids: Iterable<string>): Promise<void>;
  /** Start fetching the rest of the dataset. The caller decides when — a
   *  background fill started here would race the first frame for the same
   *  six connections and give the saving straight back. */
  loadRest(): void;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** `priority` is a Chrome hint: the background fill must not crowd out a
 *  buffer somebody is actually waiting to see. */
async function fetchBuffer(url: string, priority?: 'high' | 'low'): Promise<ArrayBuffer> {
  const res = await fetch(url, priority ? ({ priority } as RequestInit) : undefined);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return await res.arrayBuffer();
}

function metricUrl(lod: SculptureLOD, metric: MetricDefinition): string {
  if (!lod.metricTemplate) throw new Error('LOD has no metricTemplate');
  return lod.metricTemplate.replace('{metric}', `${metric.id}.${metric.storage}`);
}

export async function loadManifest(base = '/data'): Promise<AtlasManifest> {
  return await fetchJson<AtlasManifest>(`${base}/manifest.json`);
}

/** Does this dataset carry every metric the mode needs? */
export function datasetSupportsMode(
  dataset: SculptureDataset,
  mode: SculptureMode,
  derivedMetrics: (dataset: SculptureDataset, mode: SculptureMode) => boolean,
): boolean {
  const has = (id: string) => dataset.metrics.some((m) => m.id === id);
  if (!has(mode.heightMetric)) return false;
  if (!has(mode.colorMetric) && !derivedMetrics(dataset, mode)) return false;
  const scale = mode.colorScale;
  if (scale.type === 'categorical' && scale.saturationMetric) {
    return has(scale.saturationMetric);
  }
  return true;
}

/** The dataset a mode should render from: its declared id when that one can
 *  serve it, otherwise the first that can. */
export function resolveDataset(
  manifest: AtlasManifest,
  mode: SculptureMode,
  supports: (dataset: SculptureDataset) => boolean,
): SculptureDataset | null {
  const declared = manifest.datasets.find((d) => d.id === mode.dataset);
  if (declared && supports(declared)) return declared;
  return manifest.datasets.find(supports) ?? null;
}

/** Every metric a mode reads: height, colour, saturation, tooltip rows, and
 *  each step of whatever series it animates. The timeline needs all of its
 *  steps, so a 25-year mode still asks for 25 buffers — the saving is in the
 *  datasets that carry many unrelated metrics, which is where the atlas
 *  opens. */
export function requiredMetrics(dataset: SculptureDataset, mode: SculptureMode): Set<string> {
  const has = (id: string) => dataset.metrics.some((m) => m.id === id);
  const want = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && has(id)) want.add(id);
  };
  add(mode.heightMetric);
  add(mode.colorMetric);
  if (mode.colorScale.type === 'categorical') add(mode.colorScale.saturationMetric);
  for (const field of mode.tooltip.fields) add(field.metric);
  if (mode.time) {
    const templates = [
      mode.time.metricTemplate,
      mode.time.colorMetricTemplate,
      mode.time.saturationMetricTemplate,
    ].filter((t): t is string => Boolean(t));
    for (const t of templates) for (const step of mode.time.steps) add(t.replace('{step}', step));
  }
  return want;
}

export async function loadScene(
  manifest: AtlasManifest,
  datasetId: string | undefined,
  profile: QualityProfile,
  /** 0…1 as the buffers land. RAIN is 25 years of country LOD; without a
   *  count the wait is a blank pause with nothing to read. */
  onProgress?: (fraction: number) => void,
  /** Metrics to have in hand before resolving; the rest stream in after. */
  needed?: Set<string>,
): Promise<SceneData> {
  const dataset = datasetId
    ? manifest.datasets.find((d) => d.id === datasetId) ?? manifest.datasets[0]
    : manifest.datasets[0];
  if (!dataset) throw new Error('Manifest contains no datasets');
  // country LOD depends on the quality profile: r8 on desktop, r7 on mobile
  const lod = pickCountryLod(dataset, profile);
  if (!lod?.positions || !lod.metricTemplate) {
    throw new Error('Dataset has no un-tiled country LOD');
  }
  const tileLods = profile.streamTiles
    ? dataset.lods.filter((l) => l.tileIndex)
    : [];

  // What the opening mode reads comes first; everything else in the dataset
  // follows once there is a picture on screen. The census carries eleven
  // metrics and PEOPLE reads one, so waiting for all of them meant waiting
  // for eleven twelfths of nothing.
  const first = needed && needed.size > 0 ? dataset.metrics.filter((m) => needed.has(m.id)) : dataset.metrics;
  const later = dataset.metrics.filter((m) => !first.includes(m));

  const metrics = new Map<string, Float32Array | Uint8Array>();
  const pending = new Set(later.map((m) => m.id));

  const jobs = [
    fetchBuffer(lod.positions),
    manifest.labels ? fetchJson<CityLabel[]>(manifest.labels) : Promise.resolve([]),
    manifest.boundary
      ? fetchJson<{ rings: [number, number][][] }>(manifest.boundary)
      : Promise.resolve({ rings: [] }),
    ...first.map((m) => fetchBuffer(metricUrl(lod, m))),
  ];
  let done = 0;
  onProgress?.(0);
  const counted = jobs.map((job) =>
    job.then((value) => {
      done += 1;
      onProgress?.(done / jobs.length);
      return value;
    }),
  );
  const [positionsBuf, cities, boundary, ...metricBufs] = (await Promise.all(
    counted,
  )) as [ArrayBuffer, CityLabel[], { rings: [number, number][][] }, ...ArrayBuffer[]];

  const positions = new Float32Array(positionsBuf);
  const count = positions.length / 2;
  if (count !== lod.count) {
    throw new Error(`Position count ${count} does not match manifest count ${lod.count}`);
  }

  const store = (m: MetricDefinition, buf: ArrayBuffer) => {
    const arr = m.storage === 'f32' ? new Float32Array(buf) : new Uint8Array(buf);
    if (arr.length !== count) {
      throw new Error(`Metric ${m.id} has ${arr.length} values, expected ${count}`);
    }
    metrics.set(m.id, arr);
    pending.delete(m.id);
  };
  first.forEach((m, i) => store(m, metricBufs[i]!));

  // one in-flight fetch per metric, shared by the background fill and by
  // anyone who asks for it sooner
  const inFlight = new Map<string, Promise<void>>();
  const fetchMetric = (m: MetricDefinition, priority?: 'high' | 'low'): Promise<void> => {
    const existing = inFlight.get(m.id);
    if (existing) return existing;
    const job = fetchBuffer(metricUrl(lod, m), priority)
      .then((buf) => store(m, buf))
      .finally(() => inFlight.delete(m.id));
    inFlight.set(m.id, job);
    return job;
  };

  const ensure = async (ids: Iterable<string>): Promise<void> => {
    const wanted = [...ids].filter((id) => pending.has(id));
    if (wanted.length === 0) return;
    await Promise.all(
      wanted.map((id) => {
        const def = dataset.metrics.find((m) => m.id === id);
        return def ? fetchMetric(def, 'high') : Promise.resolve();
      }),
    );
  };

  let restStarted = false;
  const loadRest = () => {
    if (restStarted) return;
    restStarted = true;
    // One at a time. Firing all ten at once fills the pipe, and then a mode
    // the reader actually clicked has to queue behind ten buffers nobody
    // asked for — priority hints do not help once they are in flight.
    void (async () => {
      for (const m of later) {
        if (!pending.has(m.id)) continue;
        await fetchMetric(m, 'low').catch(() => undefined);
      }
    })();
  };

  return {
    manifest,
    dataset,
    lod,
    profileId: profile.id,
    tileLods,
    count,
    positions,
    metrics,
    cities,
    boundary: boundary.rings,
    pending,
    ensure,
    loadRest,
  };
}

export function metricDefinition(dataset: SculptureDataset, id: string): MetricDefinition {
  const def = dataset.metrics.find((m) => m.id === id);
  if (!def) throw new Error(`Unknown metric: ${id}`);
  return def;
}

/** Metric definition with the stats of the LOD actually being drawn.
 *  Coarser cells pool more people, so a shared stat block would flatten one
 *  resolution or blow out the other. */
export function metricForScene(scene: SceneData, id: string): MetricDefinition {
  const def = metricDefinition(scene.dataset, id);
  const perLod = scene.lod.metricStats?.[id];
  return perLod ? { ...def, stats: perLod } : def;
}
