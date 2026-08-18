#!/usr/bin/env node
// Headless render of the prototype for visual checks and hero shots.
// Usage: node scripts/screenshot-prototype.cjs <url> <out.png>
// Needs playwright: npm i -D playwright && npx playwright install chromium

(async () => {
  const [url, out] = process.argv.slice(2);
  if (!url || !out) {
    console.error('usage: screenshot-prototype.cjs <url> <out.png>');
    process.exit(1);
  }
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright missing — run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
  const browser = await chromium.launch({
    // software WebGL so this also works on machines without a GPU
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: Number(process.env.SHOT_DPR || 2),
  });
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  try {
    await page.waitForFunction('window.__RENDERED === true', { timeout: 240000 });
  } catch {
    console.error('render flag not set, screenshotting anyway');
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, timeout: 300000 });
  await browser.close();
  console.log('saved', out);
})();
