#!/usr/bin/env node
// Writes a small synthetic dataset so the atlas draws without running a
// pipeline. The real census downloads are hundreds of megabytes and take
// hours; this takes a second and produces something to look at, so the
// renderer, the modes, the timeline and the export can all be tried first.
//
//   npm run demo
//   npm run dev
//
// The numbers are invented. They are shaped to look like Germany — population
// falls off from real city centres, rents follow it, the east is emptier —
// but no value here comes from Destatis or anyone else, and the dataset says
// so in its own source label so the credit under the mode title cannot be
// mistaken for the real thing.
//
// Usage: node scripts/seed-demo.mjs [outDir] [--force]

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, GERMANY } from './germany.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const OUT = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'apps', 'web', 'public', 'data');

// Two levels, as a real dataset has: the coarse one is what the mobile
// quality profile asks for, the fine one is the desktop country view.
//
// The radii are the lattice pitch, so the hexagons tile without gaps, and
// they are chosen for a demo rather than copied from H3 — about 24k and 85k
// cells, a few megabytes and a second to generate. The real census levels
// are four and eleven times denser.
const LEVELS = [
  { resolution: 7, radiusMeters: 2400 },
  { resolution: 8, radiusMeters: 1275 },
];

/** Germany's actual population, so the demo's national total is at least the
 *  right order of magnitude. Every level is scaled to it, which also makes
 *  the levels agree with each other — the property the real pipeline has and
 *  the one that catches an aggregation bug fastest. */
const TARGET_POPULATION = 83_200_000;

/** Deterministic PRNG: the same seed gives the same demo on every machine,
 *  so a screenshot in the README keeps matching what a reader gets. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ray casting against the country outline; the cells outside are dropped so
 *  the sculpture has Germany's silhouette rather than a rectangle. */
function inGermany(lon, lat) {
  let inside = false;
  for (let i = 0, j = GERMANY.length - 1; i < GERMANY.length; j = i++) {
    const [xi, yi] = GERMANY[i];
    const [xj, yj] = GERMANY[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Hexagonal lattice over the country's bounding box. Real H3 cells would
 *  need the h3 library and buy nothing here — the renderer draws hexagons at
 *  a given centre and radius, and these are laid out on the same pitch. */
function hexCentres(radiusMeters) {
  const lons = GERMANY.map((p) => p[0]);
  const lats = GERMANY.map((p) => p[1]);
  const [west, east] = [Math.min(...lons), Math.max(...lons)];
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  // flat-topped rows: vertical pitch is √3·r, horizontal 1.5·r, odd rows offset
  const dLat = (radiusMeters * Math.sqrt(3)) / 111_320;
  const centres = [];
  let row = 0;
  for (let lat = south; lat <= north; lat += dLat, row += 1) {
    const dLon = (radiusMeters * 1.5) / (111_320 * Math.cos((lat * Math.PI) / 180));
    const offset = row % 2 === 0 ? 0 : dLon / 2;
    for (let lon = west + offset; lon <= east; lon += dLon) {
      if (inGermany(lon, lat)) centres.push([lon, lat]);
    }
  }
  return centres;
}

const KM_PER_DEG_LAT = 111.32;
function kmBetween(lon, lat, cityLon, cityLat) {
  const x = (lon - cityLon) * KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const y = (lat - cityLat) * KM_PER_DEG_LAT;
  return Math.hypot(x, y);
}

/** How urban a point is: overlapping bells around the real city coordinates,
 *  bigger cities reaching further. Everything else is derived from this, the
 *  way most census metrics really do correlate with density. */
function urbanity(lon, lat) {
  let sum = 0;
  for (const [, cityLon, cityLat, tier] of CITIES) {
    const reach = 26 / tier; // km; tier 1 cities pull from further out
    const weight = 1 / tier;
    const d = kmBetween(lon, lat, cityLon, cityLat);
    sum += weight * Math.exp(-(d * d) / (2 * reach * reach));
  }
  return sum;
}

/** Percentiles and total, computed the way the pipelines compute them: from
 *  the values actually written, per level of detail. Sharing one block
 *  between resolutions is the mistake that flattens whichever one it did not
 *  come from. */
function statsOf(values) {
  const clean = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const at = (q) => clean[Math.min(clean.length - 1, Math.floor(q * clean.length))] ?? 0;
  return {
    min: clean[0] ?? 0,
    max: clean[clean.length - 1] ?? 0,
    p50: at(0.5),
    p95: at(0.95),
    p995: at(0.995),
    sum: clean.reduce((a, b) => a + b, 0),
  };
}

function buildLevel({ resolution, radiusMeters }) {
  const centres = hexCentres(radiusMeters);
  const rand = mulberry32(0x0da7a + resolution);
  const n = centres.length;

  // Two passes: the first shapes a relative weight per cell, the second
  // turns it into people once the total is known. Scaling afterwards is what
  // keeps the national figure right at every level of detail.
  const weights = new Float64Array(n);
  let weightSum = 0;
  for (let i = 0; i < n; i += 1) {
    const [lon, lat] = centres[i];
    const east = Math.max(0, (lon - 10.5) / 4.5);
    const w = (14 + urbanity(lon, lat) * 2600) * (1 - east * 0.28);
    weights[i] = w;
    weightSum += w;
  }
  const peopleScale = TARGET_POPULATION / weightSum;

  const positions = new Float32Array(n * 2);
  const columns = {
    population_2022: new Float32Array(n),
    population_2011: new Float32Array(n),
    age_mean: new Float32Array(n),
    homes: new Float32Array(n),
    rent: new Float32Array(n),
    vacancy_rate: new Float32Array(n),
    homes_new_share: new Float32Array(n),
    household_size: new Float32Array(n),
    homes_total: new Float32Array(n),
    heating_category: new Uint8Array(n),
    heating_dominance: new Uint8Array(n),
  };

  for (let i = 0; i < n; i += 1) {
    const [lon, lat] = centres[i];
    positions[i * 2] = lon;
    positions[i * 2 + 1] = lat;

    const u = urbanity(lon, lat);
    // Averages 1, so it roughens the surface without moving the total. Kept
    // narrow on purpose: at ±40 % neighbouring columns disagree enough that
    // the country reads as hair rather than as terrain.
    const jitter = 0.78 + rand() * 0.44;
    // an east-west gradient, the one real feature everybody recognises
    const east = Math.max(0, (lon - 10.5) / 4.5);

    const people = Math.max(1, Math.round(weights[i] * peopleScale * jitter));
    columns.population_2022[i] = people;
    // shrinking east, growing south and around the big cities
    columns.population_2011[i] = Math.round(people * (1 + east * 0.12 - u * 0.05));
    columns.age_mean[i] = 42.5 + east * 3.6 - u * 2.1 + rand() * 2.4;
    const dwellings = Math.max(1, Math.round(people / (1.9 + rand() * 0.5)));
    columns.homes_total[i] = dwellings;
    columns.homes[i] = Math.round(dwellings * (0.35 + u * 0.22));
    columns.rent[i] = 5.8 + u * 6.4 - east * 0.9 + rand() * 0.9;
    columns.vacancy_rate[i] = Math.max(0.2, 3.1 + east * 4.2 - u * 1.4 + rand() * 1.6);
    columns.homes_new_share[i] = Math.max(0, 0.04 + u * 0.05 + rand() * 0.05 - east * 0.01);
    columns.household_size[i] = 2.45 - u * 0.42 + rand() * 0.18;
    // 0 gas, 1 oil, 2 district heat, 3 heat pump, 4 wood — urban centres on
    // district heat, the countryside on oil and wood
    const roll = rand();
    columns.heating_category[i] =
      u > 1.1 ? (roll < 0.6 ? 2 : 0) : u > 0.3 ? (roll < 0.7 ? 0 : 3) : roll < 0.45 ? 1 : roll < 0.8 ? 0 : 4;
    columns.heating_dominance[i] = Math.round((0.45 + rand() * 0.5) * 255);
  }

  // a fold, not Math.min(...positions): spreading tens of thousands of
  // arguments overflows the call stack
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i += 1) {
    const lon = positions[i * 2];
    const lat = positions[i * 2 + 1];
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  const round3 = (v) => Number(v.toFixed(3));
  return {
    resolution,
    radiusMeters,
    count: n,
    positions,
    columns,
    bounds: [round3(west), round3(south), round3(east), round3(north)],
  };
}

const METRICS = [
  { id: 'population_2022', storage: 'f32', aggregation: 'sum' },
  { id: 'population_2011', storage: 'f32', aggregation: 'sum' },
  { id: 'age_mean', storage: 'f32', aggregation: 'weightedMean' },
  { id: 'homes', storage: 'f32', aggregation: 'sum' },
  { id: 'rent', storage: 'f32', aggregation: 'weightedMean' },
  { id: 'heating_category', storage: 'u8', aggregation: 'categoricalDominant' },
  { id: 'heating_dominance', storage: 'u8', aggregation: 'weightedMean' },
  { id: 'vacancy_rate', storage: 'f32', aggregation: 'weightedMean' },
  { id: 'homes_new_share', storage: 'f32', aggregation: 'share' },
  { id: 'household_size', storage: 'f32', aggregation: 'harmonicMean' },
  { id: 'homes_total', storage: 'f32', aggregation: 'sum' },
];

function main() {
  const datasetDir = join(OUT, 'zensus');
  // Refuse to stand on a real pipeline run: those cost hours and gigabytes.
  if (existsSync(datasetDir) && !FORCE) {
    const real = readdirSync(datasetDir).filter((f) => f !== 'dataset.json');
    console.error(
      `${datasetDir} already holds data (${real.length} entries).\n` +
        'Refusing to overwrite a pipeline run. Pass --force if the demo is what you want there.',
    );
    process.exit(1);
  }

  const levels = LEVELS.map(buildLevel);
  for (const level of levels) {
    const dir = join(datasetDir, `r${level.resolution}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'positions.bin'), Buffer.from(level.positions.buffer));
    for (const metric of METRICS) {
      const values = level.columns[metric.id];
      writeFileSync(join(dir, `${metric.id}.${metric.storage}`), Buffer.from(values.buffer));
    }
  }

  const dataset = {
    id: 'zensus',
    spatialResolution: 100,
    metrics: METRICS.map((m) => ({
      ...m,
      // dataset-level stats come from the coarsest level, as the pipelines do
      stats: statsOf(levels[0].columns[m.id]),
    })),
    time: { kind: 'steps', steps: ['2011', '2022'], metricTemplate: 'population_{step}' },
    lods: levels
      .map((level) => ({
        resolution: level.resolution,
        count: level.count,
        bounds: level.bounds,
        cellRadiusMeters: level.radiusMeters,
        minZoom: 0,
        positions: `r${level.resolution}/positions.bin`,
        metricTemplate: `r${level.resolution}/{metric}`,
        metricStats: Object.fromEntries(
          METRICS.map((m) => [m.id, statsOf(level.columns[m.id])]),
        ),
      }))
      // finest first, the order the loader expects
      .sort((a, b) => b.resolution - a.resolution),
    source: {
      label: 'Data: synthetic demo — not official statistics',
      url: 'https://github.com/Naxter/datenriff#demo-data',
      license: 'CC0-1.0',
      provenance: { generatedAt: new Date().toISOString(), generator: 'scripts/seed-demo.mjs' },
    },
  };
  mkdirSync(datasetDir, { recursive: true });
  writeFileSync(join(datasetDir, 'dataset.json'), JSON.stringify(dataset, null, 2));

  for (const level of levels) {
    console.log(`r${level.resolution}: ${level.count.toLocaleString('en-GB')} cells`);
  }
  console.log(`wrote ${datasetDir}`);
  console.log('next: npm run build:manifest && npm run dev');
}

main();
