#!/usr/bin/env node
// Fetches the federal state outlines (BKG VG2500, 1:2.5 M) from the BKG WFS
// and writes public/data/states.json for the FOCUS control. The outlines
// are used to pick cells, not drawn — but the licence (DL-DE-BY-2.0) still
// asks for attribution, which the app shows while a state is in focus.
//
// Usage: node scripts/fetch-states.mjs [outdir]   (default apps/web/public/data)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'apps', 'web', 'public', 'data');

const WFS =
  'https://sgx.geodatenzentrum.de/wfs_vg2500?service=WFS&version=2.0.0' +
  '&request=GetFeature&typeNames=vg2500:vg2500_lan&outputFormat=application/json&srsName=EPSG:4326';

const res = await fetch(WFS);
if (!res.ok) {
  console.error(`BKG WFS: HTTP ${res.status}`);
  process.exit(1);
}
const geo = await res.json();

const round = (v) => Math.round(v * 1e5) / 1e5; // ~1 m: fine enough that shared state edges still match exactly

const states = geo.features
  // gf 9 = land; gf 8 = the states' sea and lake areas
  .filter((f) => f.properties.gf === 9)
  .map((f) => {
    const polys =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    // every ring, outer and holes: the app tests even-odd across all of them
    const rings = polys.flatMap((poly) => poly.map((ring) => ring.map(([x, y]) => [round(x), round(y)])));
    let w = 180, s = 90, e = -180, n = -90;
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
    }
    return {
      id: `DE-${f.properties.ars}`,
      name: f.properties.gen,
      nuts: f.properties.nuts,
      bbox: [w, s, e, n],
      rings,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'de'));

if (states.length !== 16) {
  console.error(`expected 16 states, got ${states.length}`);
  process.exit(1);
}

// The national outline is not a layer of this service — but the states
// tile the country exactly, so an edge that belongs to only one of them is
// on the national border. Counting edges is cheaper and more faithful than
// a polygon union, and VG2500's topology is clean enough for it: every
// interior edge appears exactly twice.
function nationalOutline(features) {
  const key = ([x, y]) => `${x},${y}`;
  const counts = new Map();
  const edges = [];
  for (const f of features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = [round(ring[i][0]), round(ring[i][1])];
          const b = [round(ring[i + 1][0]), round(ring[i + 1][1])];
          const ka = key(a);
          const kb = key(b);
          if (ka === kb) continue;
          const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          counts.set(id, (counts.get(id) ?? 0) + 1);
          edges.push({ id, a, b });
        }
      }
    }
  }
  // adjacency over the edges nobody shares
  const graph = new Map();
  const seen = new Set();
  for (const e of edges) {
    if (counts.get(e.id) !== 1 || seen.has(e.id)) continue;
    seen.add(e.id);
    for (const [from, to] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      const k = key(from);
      if (!graph.has(k)) graph.set(k, { point: from, next: [] });
      graph.get(k).next.push(to);
    }
  }
  // walk each closed ring, taking an unused step at every node
  const used = new Set();
  const rings = [];
  for (const [startKey, node] of graph) {
    for (const first of node.next) {
      const step = `${startKey}>${key(first)}`;
      if (used.has(step)) continue;
      const ring = [node.point];
      let current = first;
      let previous = node.point;
      used.add(step);
      used.add(`${key(first)}>${startKey}`);
      while (true) {
        ring.push(current);
        const here = graph.get(key(current));
        if (!here) break;
        const onward = here.next.find(
          (p) => !used.has(`${key(current)}>${key(p)}`) && key(p) !== key(previous),
        );
        if (!onward) break;
        used.add(`${key(current)}>${key(onward)}`);
        used.add(`${key(onward)}>${key(current)}`);
        previous = current;
        current = onward;
        if (key(current) === startKey) {
          ring.push(current);
          break;
        }
      }
      // a stray two-point fragment is not a ring
      if (ring.length > 3) rings.push(ring);
    }
  }
  return rings.sort((a, b) => b.length - a.length);
}

const outline = nationalOutline(geo.features.filter((f) => f.properties.gf === 9));

const year = new Date().getUTCFullYear();
const out = {
  source: 'BKG VG2500 (Verwaltungsgebiete 1:2 500 000)',
  attribution: `© GeoBasis-DE / BKG ${year}`,
  license: 'DL-DE-BY-2.0',
  url: 'https://gdz.bkg.bund.de/index.php/default/verwaltungsgebiete-1-2-500-000-stand-01-01-vg2500.html',
  states,
};
mkdirSync(OUT, { recursive: true });
const path = join(OUT, 'states.json');
writeFileSync(path, JSON.stringify(out));
const verts = states.reduce((a, s) => a + s.rings.reduce((b, r) => b + r.length, 0), 0);
console.log(`Wrote ${path}: ${states.length} states, ${verts} vertices`);

const outlinePath = join(OUT, 'outline.json');
writeFileSync(
  outlinePath,
  JSON.stringify({
    source: out.source,
    attribution: out.attribution,
    license: out.license,
    rings: outline,
  }),
);
const oVerts = outline.reduce((a, r) => a + r.length, 0);
console.log(`Wrote ${outlinePath}: ${outline.length} rings, ${oVerts} vertices`);
