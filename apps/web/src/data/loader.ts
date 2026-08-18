// Everything the country view needs is static: one JSON manifest plus raw
// little-endian typed-array buffers, fetched in parallel and handed to the
// GPU untouched. Worker-based decode comes with the tiled LODs.

import type {
  AtlasManifest,
  CityLabel,
  SculptureDataset,
  SculptureLOD,
  MetricDefinition,
} from '@datenriff/data-contracts';

export interface SceneData {
  manifest: AtlasManifest;
  dataset: SculptureDataset;
  lod: SculptureLOD;
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

export async function loadScene(base = '/data'): Promise<SceneData> {
  const manifest = await fetchJson<AtlasManifest>(`${base}/manifest.json`);
  const dataset = manifest.datasets[0];
  if (!dataset) throw new Error('Manifest contains no datasets');
  const lod = dataset.lods[0];
  if (!lod?.positions || !lod.metricTemplate) {
    throw new Error('Dataset has no un-tiled country LOD');
  }

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

  return { manifest, dataset, lod, count, positions, metrics, cities, boundary: boundary.rings };
}

export function metricDefinition(dataset: SculptureDataset, id: string): MetricDefinition {
  const def = dataset.metrics.find((m) => m.id === id);
  if (!def) throw new Error(`Unknown metric: ${id}`);
  return def;
}
