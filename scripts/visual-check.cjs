#!/usr/bin/env node
// Visual regression over the running dev server: one screenshot per mode
// (plus a mobile profile and a city zoom), compared pixel by pixel against
// the last accepted set. The data folder is not in the repo, so this is a
// local tool, not a CI job: baselines live in .visual/ (git-ignored).
//
//   npm run dev
//   node scripts/visual-check.cjs --update     # accept the current look
//   node scripts/visual-check.cjs              # diff against it
//
// Options: --url http://localhost:5173  --gpu (headless Chromium on the real
// GPU; default SwiftShader with ?shadows=0)  --threshold 0.5 (percent of
// pixels that may differ before a view fails)  --only people,wind
//
// A view that ends on a camera flight settles to within a pixel or two, and
// billboarded city labels then land on different pixels from run to run
// while the sculpture itself is identical. Those views carry their own,
// looser `threshold`; the sculpture is what the tool is watching.
//
// Views are captured with ?intro=0 so the opening sequence never leaks in.

const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
// pixelmatch 7 is ESM-only; require(esm) hands back the namespace
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.visual');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const UPDATE = args.includes('--update');
const GPU = args.includes('--gpu');
const BASE = flag('--url', 'http://localhost:5173');
const THRESHOLD = Number(flag('--threshold', '0.5'));
const ONLY = flag('--only', null)?.split(',');

const VIEWS = [
  { id: 'people', q: 'mode=people' },
  { id: 'change', q: 'mode=change' },
  { id: 'change-2011', q: 'mode=change&t=0' },
  { id: 'age', q: 'mode=age' },
  { id: 'rent', q: 'mode=rent' },
  { id: 'heating', q: 'mode=heating' },
  { id: 'homes', q: 'mode=homes' },
  { id: 'vacancy', q: 'mode=vacancy' },
  { id: 'families', q: 'mode=families' },
  { id: 'afterdark', q: 'mode=afterdark' },
  { id: 'wind', q: 'mode=wind' },
  { id: 'wind-2005', q: 'mode=wind&t=0.42' },
  { id: 'rain', q: 'mode=rain' },
  { id: 'rain-2001', q: 'mode=rain&t=0' },
  { id: 'people-mobile', q: 'mode=people&quality=mobile' },
  { id: 'people-berlin', q: 'mode=people&view=13.405,52.520,9.90,58,-18', wait: 6000 },
  { id: 'people-focus-bayern', q: 'mode=people&focus=state:DE-09', wait: 11000, threshold: 2 },
];

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright missing — run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
  fs.mkdirSync(path.join(OUT, 'current'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'baseline'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'diff'), { recursive: true });

  const browser = await chromium.launch({
    args: GPU
      ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11']
      : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));

  const results = [];
  for (const view of VIEWS) {
    if (ONLY && !ONLY.includes(view.id)) continue;
    const url = `${BASE}/?${view.q}&intro=0${GPU ? '' : '&shadows=0'}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector('.veil--hidden', { timeout: 90_000 });
    } catch {
      results.push({ id: view.id, status: 'no-render' });
      continue;
    }
    // let morph, tiles and labels settle
    await page.waitForTimeout(view.wait ?? (GPU ? 3500 : 12_000));
    const currentPath = path.join(OUT, 'current', `${view.id}.png`);
    await page.screenshot({ path: currentPath, timeout: 120_000 });
    const baselinePath = path.join(OUT, 'baseline', `${view.id}.png`);
    if (UPDATE || !fs.existsSync(baselinePath)) {
      fs.copyFileSync(currentPath, baselinePath);
      results.push({ id: view.id, status: UPDATE ? 'updated' : 'new-baseline' });
      continue;
    }
    const a = PNG.sync.read(fs.readFileSync(baselinePath));
    const b = PNG.sync.read(fs.readFileSync(currentPath));
    if (a.width !== b.width || a.height !== b.height) {
      results.push({ id: view.id, status: 'size-changed' });
      continue;
    }
    const diff = new PNG({ width: a.width, height: a.height });
    const differing = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
      threshold: 0.12,
      includeAA: false,
    });
    const pct = (100 * differing) / (a.width * a.height);
    fs.writeFileSync(path.join(OUT, 'diff', `${view.id}.png`), PNG.sync.write(diff));
    const limit = view.threshold ?? THRESHOLD;
    results.push({ id: view.id, status: pct <= limit ? 'ok' : 'changed', pct });
  }
  await browser.close();

  let failed = 0;
  for (const r of results) {
    const pct = r.pct === undefined ? '' : ` ${r.pct.toFixed(2)} %`;
    console.log(`${r.status.padEnd(13)} ${r.id}${pct}`);
    if (r.status === 'changed' || r.status === 'no-render' || r.status === 'size-changed') failed += 1;
  }
  if (failed) {
    console.error(`\n${failed} view(s) differ from the baseline — see .visual/diff/. Accept with --update.`);
    process.exit(1);
  }
})();
