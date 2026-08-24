#!/usr/bin/env node
// What the renderer costs while the camera moves: bytes pushed to the GPU,
// and whether that shows up in the frame times.
//
// It wraps `bufferData`/`bufferSubData` before the app boots and counts what
// goes through them, so it measures the shipping build with no instrumentation
// compiled in. Frame intervals come from `requestAnimationFrame` and stalls
// from the long-task observer.
//
//   npm run build && npm run preview
//   node scripts/measure-uploads.cjs --url http://localhost:4173
//
// Options: --url  --seconds 5  --view <lon,lat,zoom,pitch,bearing>  --mode people
//
// Why both halves matter: bytes alone do not tell you whether anyone can feel
// it. Measured on a discrete GPU in August 2026, panning at city zoom moved
// 70 MB in 7 s — of which 94 % was the merged tile buffer being rebuilt and
// re-uploaded whole for every tile that arrived — and cost one frame over
// 32 ms in the entire sweep. The waste is real; the stutter was not. Run this
// on the machine you actually care about before trading a day for it.

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const BASE = flag('--url', 'http://localhost:4173');
const SECONDS = Number(flag('--seconds', '5'));
const MODE = flag('--mode', 'people');
// A city, where the fine tiles actually stream. At country zoom there are no
// tiles to rebuild and the measurement reads zero for the wrong reason.
const VIEW = flag('--view', '13.405,52.520,10.40,58,-18');

/** Runs in the page before anything else: count uploads, time frames. */
function instrument() {
  const stats = { calls: 0, bytes: 0, big: [], frames: [], longTasks: [], on: false };
  window.__measure = stats;

  const note = (n) => {
    if (!stats.on || !n) return;
    stats.calls += 1;
    stats.bytes += n;
    // 100 KB separates the bulk geometry from per-frame uniforms and indices
    if (n >= 100_000) stats.big.push(n);
  };
  // `bufferData(target, size, usage)` allocates without uploading; only the
  // overload carrying data costs bandwidth.
  const bytesOf = (src) => (src == null || typeof src === 'number' ? 0 : (src.byteLength ?? 0));

  for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
    const data = proto.bufferData;
    proto.bufferData = function (...a) {
      note(bytesOf(a[1]));
      return data.apply(this, a);
    };
    const sub = proto.bufferSubData;
    proto.bufferSubData = function (...a) {
      note(bytesOf(a[2]));
      return sub.apply(this, a);
    };
  }

  let last = performance.now();
  const tick = (now) => {
    if (stats.on) stats.frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  try {
    new PerformanceObserver((list) => {
      if (!stats.on) return;
      for (const entry of list.getEntries()) stats.longTasks.push(entry.duration);
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    // long tasks are Chromium-only; the frame intervals still tell the story
  }
}

const MB = (n) => (n / 1e6).toFixed(1);

function report(label, s, seconds) {
  const frames = s.frames.slice().sort((a, b) => a - b);
  const at = (q) => frames[Math.min(frames.length - 1, Math.floor(q * frames.length))] ?? 0;
  const slow = frames.filter((f) => f > 32).length;
  const stalls = s.longTasks.reduce((a, b) => a + b, 0);
  console.log(
    `${label.padEnd(5)} ${MB(s.bytes).padStart(6)} MB in ${String(s.calls).padStart(5)} uploads` +
      `  (${MB(s.bytes / seconds)} MB/s)` +
      `   ${(frames.length / seconds).toFixed(0)} fps` +
      ` · median ${at(0.5).toFixed(1)} ms · p95 ${at(0.95).toFixed(1)} ms` +
      ` · ${slow} frame(s) >32 ms` +
      ` · ${s.longTasks.length} long task(s), ${stalls.toFixed(0)} ms`,
  );
}

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright missing — run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
  try {
    const res = await fetch(BASE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`no site at ${BASE} (${err.message})`);
    console.error('serve the production build first: npm run build && npm run preview');
    process.exit(1);
  }

  const browser = await chromium.launch({
    // the real GPU: SwiftShader would measure the CPU renderer, not this
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(instrument);
  await page.goto(`${BASE}/?mode=${MODE}&view=${VIEW}&lang=en&intro=0`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.veil--hidden', { timeout: 180_000 });
  // let this view's tiles finish arriving: otherwise the pan is measured on
  // top of the opening stream and reads high for a reason that is not panning
  await page.waitForTimeout(12_000);

  const reset = () =>
    page.evaluate(() => {
      const s = window.__measure;
      Object.assign(s, { calls: 0, bytes: 0, big: [], frames: [], longTasks: [], on: true });
    });
  const read = () =>
    page.evaluate(() => {
      const s = window.__measure;
      return {
        calls: s.calls,
        bytes: s.bytes,
        big: s.big.slice(),
        frames: s.frames.slice(),
        longTasks: s.longTasks.slice(),
      };
    });

  // Baseline: same duration, camera still. Anything uploaded here is being
  // re-sent for no reason at all.
  await reset();
  await page.waitForTimeout(SECONDS * 1000);
  const idle = await read();

  await reset();
  const started = Date.now();
  await page.mouse.move(700, 500);
  await page.mouse.down();
  const stepMs = 40;
  const steps = Math.round((SECONDS * 1000) / stepMs);
  for (let i = 0; i < steps; i += 1) {
    // a loop rather than a straight drag, so tiles keep entering and leaving
    // the near-field zone instead of the view settling
    const phase = (i / steps) * Math.PI * 2;
    await page.mouse.move(700 + Math.sin(phase) * 260, 500 + Math.cos(phase) * 60);
    await page.waitForTimeout(stepMs);
  }
  await page.mouse.up();
  const panSeconds = (Date.now() - started) / 1000;
  const pan = await read();
  await browser.close();

  report('idle', idle, SECONDS);
  report('pan', pan, panSeconds);

  if (pan.big.length > 0) {
    const bytes = pan.big.reduce((a, b) => a + b, 0);
    const largest = Math.max(...pan.big);
    console.log(
      `\nbulk uploads (>=100 KB): ${pan.big.length}, ${MB(bytes)} MB` +
        ` — ${((100 * bytes) / pan.bytes).toFixed(0)} % of everything sent` +
        `\n  largest ${(largest / 1024).toFixed(0)} KB` +
        ` ≈ ${Math.round(largest / 8).toLocaleString('en-GB')} cells at 8 B each (positions)` +
        `\n  ${new Set(pan.big).size} distinct sizes of ${pan.big.length}` +
        ' — a fresh size every time means the buffer was rebuilt, not amended',
    );
  }
})();
