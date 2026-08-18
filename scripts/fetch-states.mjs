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

const round = (v) => Math.round(v * 1e4) / 1e4; // ~10 m, plenty for 1:2.5 M

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
