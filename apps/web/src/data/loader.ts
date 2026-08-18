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
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
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

export async function loadScene(
  manifest: AtlasManifest,
  datasetId: string | undefined,
  profile: QualityProfile,
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

  const [positionsBuf, cities, boundary, ...metricBufs] = await Promise.all([
    fetchBuffer(lod.positions),
    manifest.labels ? fetchJson<CityLabel[]>(manifest.labels) : Promise.resolve([]),
    manifest.boundary
      ? fetchJson<{ rings: [number, number][][] }>(manifest.boundary)
      : Promise.resolve({ rings: [] }),
    ...dataset.metrics.map((m) => fetchBuffer(metricUrl(lod, m))),
  ]);

  const positions = new Float32Array(positionsBuf);
  const count = positions.length / 2;
  if (count !== lod.count) {
    throw new Error(`Position count ${count} does not match manifest count ${lod.count}`);
  }

  const metrics = new Map<string, Float32Array | Uint8Array>();
  dataset.metrics.forEach((m, i) => {
    const buf = metricBufs[i]!;
    const arr = m.storage === 'f32' ? new Float32Array(buf) : new Uint8Array(buf);
    if (arr.length !== count) {
      throw new Error(`Metric ${m.id} has ${arr.length} values, expected ${count}`);
    }
    metrics.set(m.id, arr);
  });

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
