#!/usr/bin/env node
// Synthetic demo dataset: a Germany-shaped hex lattice with plausible but
// fake metrics, written in the same binary layout as the real census
// pipeline. Deterministic and dependency-free, so the app runs without the
// multi-GB downloads.
// Usage: node scripts/generate-demo-data.mjs [outDir] [--coarse] [--no-tiles]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'apps', 'web', 'public', 'data');
// lattice grain, matched to H3 average cell areas: 8 ≈ 0.74 km², 7 ≈ 5.16 km², 9 ≈ 0.105 km²
const RES = args.includes('--coarse') ? 7 : 8;
const HEX_RADIUS_BY_RES = { 7: 1409, 8: 533, 9: 201 };
// finer tiled LOD for the zoomed-in view (population only, ~3.4M cells)
const TILE_RES = 9;
const WITH_TILES = !args.includes('--no-tiles') && !args.includes('--coarse');
/** Tile bucket edge in km — groups the fine lattice like an H3 parent would. */
const TILE_KM = 26;

// Rough Germany outline (lon, lat). Only used for the demo silhouette; the
// real pipeline derives cells from the official grids.
const GERMANY = [
  [7.19, 53.31], [6.99, 53.36], [7.29, 53.68], [8.02, 53.71], [8.36, 53.6],
  [8.55, 53.53], [8.62, 53.88], [8.9, 53.83], [8.83, 54.03], [8.6, 54.33],
  [8.57, 54.75], [8.66, 54.91], [9.44, 54.83], [9.98, 54.7], [10.03, 54.5],
  [10.14, 54.33], [10.75, 54.31], [11.09, 54.53], [11.24, 54.4], [10.9, 54.1],
  [11.24, 54.0], [11.46, 54.15], [12.1, 54.18], [12.52, 54.47], [12.9, 54.44],
  [13.4, 54.65], [13.76, 54.54], [13.83, 54.11], [14.2, 53.92], [14.3, 53.55],
  [14.14, 52.97], [14.64, 52.57], [14.55, 52.35], [14.6, 52.27], [14.76, 51.55],
  [14.98, 51.33], [14.83, 50.87], [14.3, 50.88], [13.9, 50.75], [13.03, 50.42],
  [12.32, 50.26], [12.4, 49.97], [12.55, 49.92], [12.4, 49.75], [12.66, 49.43],
  [12.79, 49.21], [13.4, 48.98], [13.84, 48.77], [13.44, 48.56], [13.03, 48.26],
  [12.93, 48.21], [12.76, 48.12], [13.0, 47.85], [13.08, 47.7], [12.78, 47.67],
  [12.24, 47.69], [11.63, 47.59], [11.27, 47.4], [10.98, 47.4], [10.7, 47.55],
  [10.28, 47.27], [9.97, 47.5], [9.55, 47.54], [9.17, 47.66], [8.87, 47.65],
  [8.6, 47.8], [8.2, 47.62], [7.59, 47.56], [7.51, 47.9], [7.57, 48.3],
  [7.8, 48.59], [8.23, 48.97], [7.94, 49.05], [7.45, 49.17], [7.0, 49.11],
  [6.56, 49.42], [6.38, 49.47], [6.12, 49.6], [6.14, 50.13], [6.4, 50.32],
  [6.01, 50.76], [6.09, 50.92], [5.96, 51.04], [6.17, 51.34], [6.09, 51.6],
  [5.95, 51.83], [6.41, 51.83], [6.83, 51.97], [7.07, 52.24], [7.07, 52.4],
  [6.71, 52.63], [7.05, 52.64], [7.21, 53.01],
];

// name, lon, lat, population (thousands), label tier, rent factor, growth city
const CITIES = [
  ['Berlin', 13.405, 52.52, 3700, 1, 1.25, true],
  ['Hamburg', 9.99, 53.55, 1900, 1, 1.3, true],
  ['München', 11.575, 48.14, 1510, 1, 1.6, true],
  ['Köln', 6.96, 50.94, 1090, 1, 1.2, true],
  ['Frankfurt am Main', 8.68, 50.11, 775, 1, 1.4, true],
  ['Stuttgart', 9.18, 48.78, 630, 1, 1.3, false],
  ['Düsseldorf', 6.78, 51.23, 620, 1, 1.2, false],
  ['Leipzig', 12.37, 51.34, 620, 1, 0.95, true],
  ['Dortmund', 7.47, 51.51, 590, 2, 1.0, false],
  ['Essen', 7.01, 51.46, 580, 2, 1.0, false],
  ['Bremen', 8.8, 53.08, 570, 1, 1.0, false],
  ['Dresden', 13.74, 51.05, 560, 1, 0.95, true],
  ['Hannover', 9.73, 52.37, 550, 1, 1.05, false],
  ['Nürnberg', 11.08, 49.45, 520, 1, 1.1, false],
  ['Duisburg', 6.76, 51.43, 500, 3, 0.9, false],
  ['Bochum', 7.22, 51.48, 365, 3, 0.95, false],
  ['Wuppertal', 7.15, 51.26, 355, 3, 0.95, false],
  ['Bielefeld', 8.53, 52.03, 335, 2, 0.95, false],
  ['Bonn', 7.1, 50.73, 330, 2, 1.15, false],
  ['Münster', 7.63, 51.96, 320, 2, 1.1, true],
  ['Karlsruhe', 8.4, 49.01, 310, 2, 1.1, false],
  ['Mannheim', 8.47, 49.49, 310, 2, 1.05, false],
  ['Augsburg', 10.9, 48.37, 300, 2, 1.1, false],
  ['Wiesbaden', 8.24, 50.08, 280, 3, 1.2, false],
  ['Kiel', 10.14, 54.32, 250, 2, 1.0, false],
  ['Aachen', 6.08, 50.78, 250, 3, 1.0, false],
  ['Braunschweig', 10.52, 52.26, 250, 3, 0.95, false],
  ['Chemnitz', 12.92, 50.83, 245, 3, 0.8, false],
  ['Halle (Saale)', 11.97, 51.48, 240, 3, 0.85, false],
  ['Magdeburg', 11.63, 52.13, 236, 2, 0.85, false],
  ['Freiburg', 7.85, 47.99, 235, 2, 1.25, true],
  ['Krefeld', 6.56, 51.33, 230, 3, 0.9, false],
  ['Lübeck', 10.69, 53.87, 220, 3, 1.0, false],
  ['Mainz', 8.27, 50.0, 220, 3, 1.2, false],
  ['Erfurt', 11.03, 50.98, 215, 2, 0.9, true],
  ['Rostock', 12.1, 54.09, 210, 2, 0.95, true],
  ['Kassel', 9.5, 51.31, 200, 3, 0.95, false],
  ['Potsdam', 13.06, 52.4, 185, 3, 1.15, true],
  ['Saarbrücken', 7.0, 49.23, 180, 2, 0.9, false],
  ['Oldenburg', 8.21, 53.14, 170, 3, 0.95, false],
  ['Osnabrück', 8.05, 52.28, 165, 3, 0.95, false],
  ['Regensburg', 12.1, 49.02, 155, 3, 1.15, true],
  ['Ulm', 9.99, 48.4, 130, 3, 1.1, false],
  ['Würzburg', 9.93, 49.79, 128, 3, 1.05, false],
  ['Jena', 11.59, 50.93, 110, 3, 0.95, true],
];

// deterministic noise
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Value noise in [0,1], cellSize in the same unit as x/y (km here). */
function valueNoise(x, y, cellSize, seed) {
  const gx = x / cellSize;
  const gy = y / cellSize;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = smooth(gx - ix);
  const fy = smooth(gy - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x, y, seed) {
  return (
    0.55 * valueNoise(x, y, 90, seed) +
    0.3 * valueNoise(x, y, 28, seed + 101) +
    0.15 * valueNoise(x, y, 9, seed + 202)
  );
}

// geometry
function pointInPolygon(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const LAT0 = 51.1;
const LON0 = 10.4;
const M_PER_DEG_LAT = 111_132;
const M_PER_DEG_LON0 = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

/** Local km coordinates (equirectangular around the country centroid). */
const toKm = (lon, lat) => [
  ((lon - LON0) * 111.32 * Math.cos((lat * Math.PI) / 180)),
  (lat - LAT0) * 111.132,
];

// Hex lattice: nearest-neighbour distance D, area/cell = sqrt(3)/2*D^2,
// radius R = D/sqrt(3).
const HEX_RADIUS_M = HEX_RADIUS_BY_RES[RES];

function buildLattice(hexRadiusM) {
  const dM = Math.sqrt(3) * hexRadiusM;
  const rowM = (dM * Math.sqrt(3)) / 2;
  const positions = [];
  const minLat = 47.2;
  const maxLat = 55.1;
  const minLon = 5.8;
  const maxLon = 15.1;
  const yMin = (minLat - LAT0) * M_PER_DEG_LAT;
  const yMax = (maxLat - LAT0) * M_PER_DEG_LAT;
  let row = 0;
  for (let y = yMin; y <= yMax; y += rowM, row++) {
    const lat = LAT0 + y / M_PER_DEG_LAT;
    const mPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
    const xMin = (minLon - LON0) * M_PER_DEG_LON0;
    const xMax = (maxLon - LON0) * M_PER_DEG_LON0;
    const offset = row % 2 === 0 ? 0 : dM / 2;
    for (let x = xMin + offset; x <= xMax; x += dM) {
      const lon = LON0 + x / mPerDegLon;
      if (pointInPolygon(lon, lat, GERMANY)) {
        positions.push(lon, lat);
      }
    }
  }
  return new Float32Array(positions);
}

// synthetic metrics
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function isEast(lon, lat) {
  return (
    (lat >= 50.15 && lat < 51.7 && lon > 9.95) ||
    (lat >= 51.7 && lat < 53.5 && lon > 10.6) ||
    (lat >= 53.5 && lon > 11.6)
  );
}

function generate(positions, res = RES) {
  const n = positions.length / 2;
  const rand = mulberry32(20220515);

  const pop2022 = new Float32Array(n);
  const pop2011 = new Float32Array(n);
  const age = new Float32Array(n);
  const homes = new Float32Array(n);
  const rent = new Float32Array(n);
  const heatCat = new Uint8Array(n);
  const heatDom = new Uint8Array(n);

  // per-city kernel parameters, precomputed
  const cityKm = CITIES.map(([, lon, lat]) => toKm(lon, lat));
  const citySCore = CITIES.map(([, , , popK]) => 2.4 + 1.35 * Math.sqrt(popK / 250));
  const citySMetro = citySCore.map((s) => 3.2 * s);
  const cityCutoff2 = citySMetro.map((s) => (5 * s) ** 2);

  // fine per-cell jitter; more at fine resolution where single villages show
  const jitterSigma = res >= 9 ? 0.4 : res >= 8 ? 0.32 : 0.2;

  for (let i = 0; i < n; i++) {
    const lon = positions[i * 2];
    const lat = positions[i * 2 + 1];
    const [x, y] = toKm(lon, lat);
    const east = isEast(lon, lat);
    const noise = fbm(x, y, 7);

    // population 2022, relative units (normalised later). Regional factors
    // ramp smoothly; hard thresholds would print as seams.
    const band = (v, lo, hi, w) =>
      smooth(clamp((v - lo) / w, 0, 1)) * smooth(clamp((hi - v) / w, 0, 1));
    let ruralFactor = 0.55 + 0.9 * noise;
    const neSparse =
      smooth(clamp((lat - 51.9) / 0.6, 0, 1)) * smooth(clamp((lon - 10.9) / 0.9, 0, 1));
    ruralFactor *= 1 - 0.55 * neSparse;
    ruralFactor *= 1 + 0.35 * band(lon, 5.7, 9.6, 0.6) * band(lat, 50.2, 52.7, 0.5); // Rhineland belt

    // Settlement texture: population clumps into towns and villages instead
    // of a smooth carpet. Applied to rural base and (weaker) metro fringe.
    const settle = valueNoise(x, y, 7.5, 811);
    const village = valueNoise(x, y, 2.7, 812);
    let texture = 0.28 + 1.55 * Math.pow(Math.max(0, settle - 0.18) / 0.82, 1.5);
    if (village > 0.72) texture += (village - 0.72) * 11;

    let rural = 28 * ruralFactor * texture;
    let coreSum = 0;
    let metroSum = 0;

    let cityInfluence = 0; // 0..1-ish, strongest in cores — reused by rent/age/heating
    let rentFactorAcc = 0;
    let growthCityInfluence = 0;
    for (let c = 0; c < CITIES.length; c++) {
      const dx = x - cityKm[c][0];
      const dy = y - cityKm[c][1];
      const r2 = dx * dx + dy * dy;
      if (r2 > cityCutoff2[c]) continue;
      const [, , , popK, , rentFactor, growth] = CITIES[c];
      const sCore = citySCore[c];
      const sMetro = citySMetro[c];
      const core = Math.exp(-r2 / (2 * sCore * sCore));
      const metro = Math.exp(-r2 / (2 * sMetro * sMetro));
      const mod = 0.75 + 0.5 * noise;
      coreSum += popK * 0.6 * core * mod;
      metroSum += popK * 0.13 * metro * mod;
      const infl = clamp(0.62 * core + 0.38 * metro, 0, 1);
      if (infl > cityInfluence) cityInfluence = infl;
      rentFactorAcc = Math.max(rentFactorAcc, infl * rentFactor);
      if (growth) growthCityInfluence = Math.max(growthCityInfluence, infl);
    }
    let p = rural + coreSum + metroSum * (0.5 + 0.7 * texture);

    // alpine thinning towards the southern border
    const alpine = clamp((lat - 47.55) / 0.55, 0, 1);
    p *= 0.5 + 0.5 * smooth(alpine);

    // log-normal per-cell jitter, stronger away from dense cores
    const u1 = Math.max(1e-6, hash2(i, 17, 991));
    const u2 = hash2(i, 31, 992);
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    p *= Math.exp(jitterSigma * (1 - 0.75 * cityInfluence) * gauss);
    pop2022[i] = p;

    // population 2011
    let growthRate;
    if (east) {
      // shrinking east, except the growth cities
      growthRate = -0.11 + 0.06 * noise + 0.2 * growthCityInfluence;
    } else {
      growthRate = 0.005 + 0.03 * noise + 0.09 * growthCityInfluence;
    }
    growthRate += (rand() - 0.5) * 0.02;
    pop2011[i] = p / (1 + growthRate);

    // mean age
    let a = 44.6 + 3.2 * (0.5 - noise);
    if (east) a += 3.6 * (1 - cityInfluence);
    a -= 4.2 * growthCityInfluence;
    a += (rand() - 0.5) * 1.6;
    age[i] = clamp(a, 38, 55);

    // homes
    const homesPerCapita = 0.5 + 0.05 * (east ? 1 : 0) + 0.04 * (noise - 0.5);
    homes[i] = p * homesPerCapita;

    // rent €/m²
    let rentVal = 6.1 + 0.9 * (noise - 0.5);
    rentVal += 7.5 * cityInfluence * Math.max(rentFactorAcc, 0.75);
    if (east && cityInfluence < 0.25) rentVal -= 0.8;
    if (!east && lon < 9.6) rentVal += 0.35;
    rent[i] = clamp(rentVal, 4.4, 21);

    // heating: gas, oil, district, heat pump, electric, biomass
    const ruralness = clamp(1 - cityInfluence * 1.6, 0, 1);
    const south = clamp((50.2 - lat) / 2.6, 0, 1);
    const west = clamp((10.6 - lon) / 4.2, 0, 1);
    const newBuild = valueNoise(x, y, 14, 909);
    const scores = [
      0.3 + 0.12 * west + 0.12 * (1 - ruralness) - 0.24 * cityInfluence + 0.1 * valueNoise(x, y, 30, 303),
      0.08 + 0.36 * ruralness * (0.3 + 0.7 * south) + 0.08 * valueNoise(x, y, 22, 404),
      0.02 + 0.7 * cityInfluence * (east ? 1.25 : 0.9),
      0.04 + 1.5 * Math.max(0, newBuild - 0.64) * (0.35 + 0.65 * ruralness),
      0.04 + 1.4 * Math.max(0, valueNoise(x, y, 12, 606) - 0.75),
      0.02 + 1.7 * ruralness * (0.25 + 0.75 * south) * Math.max(0, valueNoise(x, y, 16, 707) - 0.52),
    ];
    let best = 0;
    let total = 0;
    for (let s = 0; s < scores.length; s++) {
      total += scores[s];
      if (scores[s] > scores[best]) best = s;
    }
    heatCat[i] = best;
    heatDom[i] = Math.round(clamp(scores[best] / total, 0.2, 0.95) * 255);
  }

  // normalise population to the published national totals
  const scaleTo = (arr, target) => {
    let sum = 0;
    for (const v of arr) sum += v;
    const f = target / sum;
    for (let i = 0; i < arr.length; i++) arr[i] = Math.round(arr[i] * f);
  };
  scaleTo(pop2022, 82_700_000);
  scaleTo(pop2011, 80_200_000);
  for (let i = 0; i < n; i++) homes[i] = Math.round(homes[i] * (43_100_000 / 41_500_000));

  return { pop2022, pop2011, age, homes, rent, heatCat, heatDom };
}

// stats + binary writing
function stats(arr, { sum = false } = {}) {
  const sorted = Float64Array.from(arr).sort();
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const s = { min: sorted[0], max: sorted[sorted.length - 1], p50: q(0.5), p95: q(0.95), p995: q(0.995) };
  if (sum) s.sum = [...arr].reduce((a, b) => a + b, 0);
  const round = (v) => Math.round(v * 100) / 100;
  for (const k of Object.keys(s)) s[k] = round(s[k]);
  return s;
}

/** Tiled fine LOD: cells bucketed on a km grid, one buffer set per tile. */
function writeTiles(baseDir, positions, metrics) {
  const n = positions.length / 2;
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const [x, y] = toKm(positions[i * 2], positions[i * 2 + 1]);
    const id = `t${Math.floor(x / TILE_KM)}_${Math.floor(y / TILE_KM)}`;
    let g = groups.get(id);
    if (!g) groups.set(id, (g = []));
    g.push(i);
  }

  const tilesDir = join(baseDir, 'tiles');
  mkdirSync(tilesDir, { recursive: true });
  const entries = [];
  for (const [id, indices] of groups) {
    const pos = new Float32Array(indices.length * 2);
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    indices.forEach((src, k) => {
      const lon = positions[src * 2];
      const lat = positions[src * 2 + 1];
      pos[k * 2] = lon;
      pos[k * 2 + 1] = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
    writeFileSync(join(tilesDir, `${id}.positions.bin`), Buffer.from(pos.buffer));
    for (const [name, arr] of Object.entries(metrics)) {
      const slice = new Float32Array(indices.length);
      indices.forEach((src, k) => { slice[k] = arr[src]; });
      writeFileSync(join(tilesDir, `${id}.${name}.f32`), Buffer.from(slice.buffer));
    }
    const round4 = (v) => Math.round(v * 10000) / 10000;
    entries.push({
      id,
      count: indices.length,
      bounds: [round4(minLon), round4(minLat), round4(maxLon), round4(maxLat)],
    });
  }

  const index = {
    resolution: TILE_RES,
    cellRadiusMeters: HEX_RADIUS_BY_RES[TILE_RES],
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([name, arr]) => [
        name.replace(/\.f32$/, ''),
        stats(arr, { sum: name.startsWith('population') }),
      ]),
    ),
    tiles: entries.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  writeFileSync(join(baseDir, 'index.json'), JSON.stringify(index));
  return { tileCount: entries.length, count: n };
}

/** Every pipeline output under OUT/<dir>/dataset.json, URLs rebased for the
 *  app. Each pipeline owns its own cell universe, so they stay separate
 *  datasets and the app switches scenes per mode. */
function loadPipelineDatasets() {
  const dirs = ['zensus', 'afterdark'];
  const datasets = [];
  for (const dir of dirs) {
    const path = join(OUT, dir, 'dataset.json');
    if (!existsSync(path)) continue;
    const dataset = JSON.parse(readFileSync(path, 'utf8'));
    const rebase = (p) => (p && !p.startsWith('/') ? `/data/${dir}/${p}` : p);
    for (const lod of dataset.lods ?? []) {
      for (const key of ['positions', 'metricTemplate', 'tileIndex', 'tileTemplate', 'positionsTemplate']) {
        if (lod[key]) lod[key] = rebase(lod[key]);
      }
    }
    datasets.push(dataset);
  }
  return datasets;
}

function main() {
  console.log('Building hex lattice …');
  const positions = buildLattice(HEX_RADIUS_M);
  const n = positions.length / 2;
  console.log(`  ${n.toLocaleString('en')} cells (${(Math.sqrt(3) * HEX_RADIUS_M) | 0} m spacing)`);

  console.log('Generating synthetic metrics …');
  const m = generate(positions);
  console.log(`  population 2022 total: ${(stats(m.pop2022, { sum: true }).sum / 1e6).toFixed(1)} M`);
  console.log(`  population peak cell:  ${Math.round(stats(m.pop2022).max).toLocaleString('en')}`);

  const lodDir = join(OUT, 'demo', `r${RES}`);
  mkdirSync(lodDir, { recursive: true });

  const write = (name, typed) => writeFileSync(join(lodDir, name), Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength));
  write('positions.bin', positions);
  write('population_2022.f32', m.pop2022);
  write('population_2011.f32', m.pop2011);
  write('age_mean.f32', m.age);
  write('homes.f32', m.homes);
  write('rent.f32', m.rent);
  write('heating_category.u8', m.heatCat);
  write('heating_dominance.u8', m.heatDom);

  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (let i = 0; i < n; i++) {
    const lon = positions[i * 2];
    const lat = positions[i * 2 + 1];
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const bounds = [minLon, minLat, maxLon, maxLat].map((v) => Math.round(v * 100) / 100);

  // finer, tiled LOD for the zoomed-in view: population only, so the other
  // modes fall back to the country LOD when zoomed in
  let fineLod = null;
  if (WITH_TILES) {
    console.log('Building fine lattice for tiles …');
    const finePositions = buildLattice(HEX_RADIUS_BY_RES[TILE_RES]);
    const fineN = finePositions.length / 2;
    console.log(`  ${fineN.toLocaleString('en')} cells`);
    const fine = generate(finePositions, TILE_RES);
    const fineDir = join(OUT, 'demo', `r${TILE_RES}`);
    mkdirSync(fineDir, { recursive: true });
    const { tileCount } = writeTiles(fineDir, finePositions, {
      population_2022: fine.pop2022,
      population_2011: fine.pop2011,
    });
    console.log(`  ${tileCount} tiles written`);
    fineLod = {
      resolution: TILE_RES,
      count: fineN,
      bounds,
      cellRadiusMeters: HEX_RADIUS_BY_RES[TILE_RES],
      minZoom: 6.4,
      tileIndex: `/data/demo/r${TILE_RES}/index.json`,
      tileTemplate: `/data/demo/r${TILE_RES}/tiles/{tile}.{metric}`,
      positionsTemplate: `/data/demo/r${TILE_RES}/tiles/{tile}.positions.bin`,
    };
  }

  const metric = (id, label, unit, storage, aggregation, extra = {}, arr, statOpts) => ({
    id, label, unit, storage, aggregation, ...extra, stats: stats(arr, statOpts),
  });

  const dataset = {
    id: 'zensus_demo',
    title: 'Zensus (Demo)',
    spatialResolution: 100,
    metrics: [
      metric('population_2022', 'Population 2022', 'people', 'f32', 'sum', {}, m.pop2022, { sum: true }),
      metric('population_2011', 'Population 2011', 'people', 'f32', 'sum', {}, m.pop2011, { sum: true }),
      metric('age_mean', 'Average age', 'years', 'f32', 'weightedMean', { denominatorMetric: 'population_2022' }, m.age),
      metric('homes', 'Homes', 'homes', 'f32', 'sum', {}, m.homes, { sum: true }),
      metric('rent', 'Net cold rent', '€/m²', 'f32', 'weightedMean', { denominatorMetric: 'homes' }, m.rent),
      metric('heating_category', 'Dominant heating source', undefined, 'u8', 'categoricalDominant', {
        categories: ['Gas', 'Heizöl', 'Fernwärme', 'Wärmepumpe', 'Strom', 'Biomasse', 'Sonstige'],
      }, m.heatCat),
      metric('heating_dominance', 'Heating dominance', undefined, 'u8', 'weightedMean', { denominatorMetric: 'homes' }, m.heatDom),
    ],
    time: { kind: 'steps', steps: ['2011', '2022'], metricTemplate: 'population_{step}' },
    lods: [
      {
        resolution: RES,
        count: n,
        bounds,
        cellRadiusMeters: HEX_RADIUS_M,
        minZoom: 0,
        positions: `/data/demo/r${RES}/positions.bin`,
        metricTemplate: `/data/demo/r${RES}/{metric}`,
      },
      ...(fineLod ? [fineLod] : []),
    ],
    source: {
      label: 'Synthetic demo data — not real census values',
      license: 'Generated, see scripts/generate-demo-data.mjs',
      referenceDate: '2022-05-15',
      provenance: {
        pipelineVersion: 'demo-generator 0.1.0',
        generatedAt: new Date().toISOString(),
      },
    },
  };

  // real pipeline outputs come first; the synthetic demo stays as fallback
  const pipelines = loadPipelineDatasets();
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    datasets: [...pipelines, dataset],
    labels: '/data/cities.json',
    boundary: '/data/boundary.json',
  };
  for (const d of pipelines) {
    console.log(`Including dataset "${d.id}" (${d.metrics.length} metrics)`);
  }

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(OUT, 'cities.json'),
    JSON.stringify(CITIES.map(([name, lon, lat, , tier]) => ({ name, lon, lat, tier })), null, 2),
  );
  writeFileSync(join(OUT, 'boundary.json'), JSON.stringify({ rings: [GERMANY] }));

  console.log(`Wrote ${lodDir}`);
  console.log('Done.');
}

main();
