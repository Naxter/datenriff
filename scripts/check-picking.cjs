#!/usr/bin/env node
// Regression check for hover picking: drives a real browser over the running
// dev server and asserts that a tooltip appears. deck.gl 9.3 renders nothing
// into its offscreen picking framebuffer, which silently kills every hover —
// run this after any deck.gl upgrade.
//
// Usage: npm run dev, then: node scripts/check-picking.cjs [url]
// Needs playwright: npm i -D playwright && npx playwright install chromium
// Slow and timing-sensitive on software rendering; raise PICK_WAIT_MS there.

const HOVER_POINTS = [
  [700, 450],
  [620, 500],
  [780, 420],
  [560, 560],
  [700, 380],
  [850, 500],
];

(async () => {
  const url = process.argv[2] || 'http://localhost:5173/?mode=people';
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright missing — run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }

  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  // not networkidle: the app keeps streaming LOD tiles, so it never settles
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Fixed wait: deck's canvas never counts as "visible" for Playwright's
  // waiters. Software rendering (SwiftShader) needs far longer than a GPU to
  // get half a million columns on screen, so allow overriding the wait.
  await page.waitForTimeout(Number(process.env.PICK_WAIT_MS || 15000));

  let tooltip = null;
  for (const [x, y] of HOVER_POINTS) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(400);
    tooltip = await page.evaluate(() => {
      const el = document.querySelector('.tooltip');
      return el ? el.innerText.replace(/\s*\n\s*/g, ' · ') : null;
    });
    if (tooltip) break;
  }
  await browser.close();

  if (!tooltip) {
    console.error(`picking broken: no tooltip after ${HOVER_POINTS.length} hover points`);
    process.exit(1);
  }
  console.log('picking ok:', tooltip);
})();
