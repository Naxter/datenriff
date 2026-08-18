// Shared contracts: every data source is normalised offline into the same
// spatial model (hex cells at several resolutions) plus binary metric
// buffers, described by the manifest types below. The renderer never needs
// to know where a dataset came from.

/** How metric values combine when aggregating to a coarser LOD. */
export type AggregationRule =
  | 'sum'
  | 'weightedMean'
  | 'share'
  | 'categoricalDominant';

/** On-disk / GPU storage of a metric buffer. */
export type MetricStorage =
  /** Little-endian float32 per cell; NaN = suppressed/missing. */
  | 'f32'
  /** Byte per cell; categories, or [0,1] quantised to 0–255. */
  | 'u8';

/** Robust distribution stats, precomputed offline per metric. */
export interface MetricStats {
  min: number;
  max: number;
  p50: number;
  p95: number;
  p995: number;
  sum?: number;
}

export interface MetricDefinition {
  /** Stable id, doubles as the buffer file stem. */
  id: string;
  label: string;
  unit?: string;
  storage: MetricStorage;
  aggregation: AggregationRule;
  /** Weight/denominator metric for weightedMean and share. */
  denominatorMetric?: string;
  /** Category labels indexed by the u8 value. */
  categories?: string[];
  stats?: MetricStats;
}

/** [west, south, east, north] in WGS84 degrees. */
export type LonLatBounds = [number, number, number, number];

/** One level of detail. Country LOD is a single buffer set; finer LODs are tiled. */
export interface SculptureLOD {
  resolution: number;
  count: number;
  bounds: LonLatBounds;
  /** Cell radius (centre → vertex) in metres, before overlap. */
  cellRadiusMeters: number;
  minZoom: number;
  maxZoom?: number;
  /** Un-tiled: URL of the interleaved [lon,lat] float32 buffer. */
  positions?: string;
  /** Un-tiled: URL template, `{metric}` → "<id>.<storage>". */
  metricTemplate?: string;
  /** Tiled: URL of the TileIndex JSON. */
  tileIndex?: string;
  /** Tiled: URL template, `{tile}` → tile id, `{metric}` → "<id>.<storage>". */
  tileTemplate?: string;
  /** Tiled: URL template, `{tile}` → tile id, for the positions buffer. */
  positionsTemplate?: string;
  tileParentResolution?: number;
}

/** One tile of a tiled LOD. */
export interface TileIndexEntry {
  id: string;
  count: number;
  bounds: LonLatBounds;
}

/** index.json of a tiled LOD. Stats are per LOD — finer cells have their
 * own value distribution, so colour and height calibrate against these. */
export interface TileIndex {
  resolution: number;
  cellRadiusMeters: number;
  metrics: Record<string, MetricStats>;
  tiles: TileIndexEntry[];
}

export interface AttributionDefinition {
  label: string;
  url?: string;
  license?: string;
  referenceDate?: string;
  provenance?: {
    sourceUrl?: string;
    sourceHash?: string;
    downloadDate?: string;
    pipelineVersion?: string;
    gitCommit?: string;
    generatedAt?: string;
  };
}

/** Time axis: census years, monthly composites, rain frames … */
export interface TimeDefinition {
  kind: 'steps';
  steps: string[];
  /** Metric id template, `{step}` replaced by the step label. */
  metricTemplate: string;
}

export interface SculptureDataset {
  id: string;
  title: string;
  /** Finest source resolution in metres (100 for the census grid). */
  spatialResolution: number;
  metrics: MetricDefinition[];
  time?: TimeDefinition;
  lods: SculptureLOD[];
  source: AttributionDefinition;
}

/** Root manifest served at /data/manifest.json. */
export interface AtlasManifest {
  version: 1;
  generatedAt: string;
  datasets: SculptureDataset[];
  labels?: string;
  boundary?: string;
}

export type SequentialScaleType = 'linear' | 'sqrt' | 'log1p';

export interface SequentialScaleDefinition {
  type: SequentialScaleType;
  palette: string;
  /** Upper clip quantile, e.g. 0.995. Mutually exclusive with domain. */
  clip?: number;
  domain?: [number, number];
  /** Exponent on the normalised ramp position; >1 keeps low values pale. */
  gamma?: number;
}

export interface DivergingScaleDefinition {
  type: 'diverging';
  palette: string;
  center: number;
  /** Half-width of the domain; derived from stats when omitted. */
  halfWidth?: number;
}

export interface CategoricalScaleDefinition {
  type: 'categorical';
  palette: string;
  /** u8 metric (0–255 ≙ 0–1) that desaturates mixed cells. */
  saturationMetric?: string;
}

export type ColorScaleDefinition =
  | SequentialScaleDefinition
  | DivergingScaleDefinition
  | CategoricalScaleDefinition;

export interface HeightScaleDefinition {
  /** Height stays linear; only the calibration anchor varies. */
  type: 'linear';
  /** Quantile the composition height is calibrated against (default 0.995). */
  calibrationQuantile?: number;
}

export interface TooltipFieldDefinition {
  metric: string;
  label: string;
  format: 'integer' | 'decimal1' | 'percent' | 'currencyPerSqm' | 'category';
}

export interface TooltipDefinition {
  fields: TooltipFieldDefinition[];
}

/** Camera preset a mode is composed for. Angles only — position and zoom
 *  come from fitting the dataset bounds to the viewport. */
export interface CameraPreset {
  pitch: number;
  bearing: number;
}

/** A curated view of a dataset: which metric drives height, which colour. */
export interface SculptureMode {
  id: string;
  label: string;
  subtitle: string;
  dataset: string;
  /** Composition angle; the view morphs there on mode switch. */
  camera?: CameraPreset;
  heightMetric: string;
  colorMetric: string;
  heightScale: HeightScaleDefinition;
  colorScale: ColorScaleDefinition;
  time?: TimeDefinition;
  tooltip: TooltipDefinition;
  attribution: AttributionDefinition;
}

export interface ViewportQuery {
  bounds: LonLatBounds;
  zoom: number;
}

export interface SculptureBuffer {
  count: number;
  positions: Float32Array;
  metrics: Map<string, Float32Array | Uint8Array>;
}

export interface SculptureTile extends SculptureBuffer {
  parent: string;
}

export interface SculptureSource {
  loadCountryLOD(): Promise<SculptureBuffer>;
  loadTiles(query: ViewportQuery): Promise<SculptureTile[]>;
  loadMetric(metricId: string): Promise<Float32Array | Uint8Array>;
}

export interface CityLabel {
  name: string;
  lon: number;
  lat: number;
  /** 1 = always visible; higher tiers appear when zooming in. */
  tier: number;
}
