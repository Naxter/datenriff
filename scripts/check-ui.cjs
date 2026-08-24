#!/usr/bin/env node
// Behavioural regression check for the interface: one browser, driven the way
// a visitor drives it, asserting that the controls are there, answer, and do
// not break the atlas.
//
// It is the counterpart to visual-check.cjs, not a replacement. That one
// compares pixels and is blind to text, to small controls and to anything
// that only happens *between* two states; this one reads the DOM and is blind
// to how any of it looks. Three regressions walked past the pixel check on
// its own: a nav that covered the legal links, city labels baked in the
// fallback font, and a crash on switching datasets — the visual check loads
// every mode from cold and therefore never switches one for another.
//
//   npm run build && npm run preview     # serve the production build on 4173
//   npm run ui                           # or: node scripts/check-ui.cjs --gpu
//
// Options: --url http://localhost:4173  --gpu (headless Chromium on the real
// GPU; default SwiftShader with ?shadows=0)  --only modes,timeline  --list
//
// Unlike the visual check there is no baseline: every assertion is written
// down here, so a failure names what broke instead of a percentage.

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const GPU = args.includes('--gpu');
const LIST = args.includes('--list');
const BASE = flag('--url', 'http://localhost:4173');
const ONLY = flag('--only', null)?.split(',');

const DESKTOP = { width: 1400, height: 900 };
// The phone shapes the visual check learned to take after a nav shipped over
// the legal links. Here they are hit-tested rather than photographed.
const VIEWPORTS = [
  { id: 'desktop', width: 1400, height: 900 },
  { id: 'phone', width: 390, height: 844 },
  // what a phone browser actually leaves once its own chrome is counted —
  // the shape the layout was worst in, and the one nothing was testing
  { id: 'phone-browser', width: 390, height: 660 },
  { id: 'phone-small', width: 320, height: 568 },
  { id: 'phone-landscape', width: 844, height: 390 },
];

// What the navigation is expected to offer, by the text it prints. This is
// the one place the suite hard-codes the product: a mode that quietly stops
// being served (a dataset missing, `bindMode` dropping it) is exactly the
// kind of absence nothing else notices. Adding a mode means adding it here —
// deliberately, the way a visual baseline is accepted deliberately.
const EXPECTED_MODES = {
  Population: ['People', 'Change', 'Age', 'Families'],
  Housing: ['Rent', 'Heating', 'Homes', 'Vacancy'],
  Nature: ['Rain', 'Land', 'Forest'],
  Energy: ['After Dark', 'Wind'],
};

// Modes that carry a timeline. Same reasoning: a mode losing its time steps
// (a pipeline that wrote one year, a template that stopped matching) leaves
// no other trace in the interface.
const EXPECTED_TIME_MODES = ['Change', 'After Dark', 'Wind', 'Rain', 'Land'];

// The demo seeder writes one synthetic census dataset, so eight modes exist
// and only CHANGE has time. Without a second expectation the suite reports
// two failures against `npm run demo` that are not faults — and a check that
// cries wolf on the documented quickstart is a check people learn to ignore.
const EXPECTED_DEMO_MODES = {
  Population: EXPECTED_MODES.Population,
  Housing: EXPECTED_MODES.Housing,
};
const EXPECTED_DEMO_TIME_MODES = ['Change'];

const results = [];
const consoleErrors = [];
let pageErrors = [];

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** Runs one named assertion and records it; a throw is a failure, not a stop. */
async function check(scenario, name, fn) {
  try {
    const note = await fn();
    results.push({ id: `${scenario}/${name}`, status: 'pass', note });
  } catch (err) {
    results.push({ id: `${scenario}/${name}`, status: 'FAIL', note: err.message });
  }
}

function skip(scenario, name, why) {
  results.push({ id: `${scenario}/${name}`, status: 'skip', note: why });
}

/** A control that cannot be clicked is a finding, not a stack trace.
 *  Playwright waits 30 s and then prints its whole retry log; something
 *  sitting on top of a button is worth one line and a quick answer. */
async function press(page, selector) {
  try {
    await page.click(selector, { timeout: 6000 });
  } catch (err) {
    const blocked = /intercepts pointer events/.test(err.message);
    throw new Error(
      blocked ? `${selector} is there but something is on top of it` : `cannot click ${selector}`,
    );
  }
}

/** Loads a view and waits for the atlas to be up. `?intro=0` keeps the
 *  opening sequence out of the way; `?lang=en` pins the text the assertions
 *  are written against, which otherwise follows the machine's locale. */
async function open(page, query, viewport = DESKTOP) {
  await page.setViewportSize(viewport);
  const url = `${BASE}/?${query}&lang=en&intro=0${GPU ? '' : '&shadows=0'}`;
  pageErrors = [];
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // …or the crash page, so a throw is reported as a throw rather than as a
  // three-minute wait for a veil that is never going to lift
  await page.waitForSelector('.veil--hidden, .unsupported', { timeout: 180_000 });
  // let the first morph, the tiles and the labels settle
  await page.waitForTimeout(GPU ? 2500 : 8000);
}

/** Is this the synthetic demo rather than a pipeline run? The demo has one
 *  census dataset and no BKG boundaries, so several checks are about things
 *  that legitimately do not exist — and a suite that reports those as faults
 *  teaches people to ignore red. Asks the manifest, not a flag, so nobody has
 *  to remember which data is on the machine. */
async function usingDemoData(page) {
  return page.evaluate(async () => {
    const res = await fetch('/data/manifest.json');
    if (!res.ok) return false;
    const manifest = await res.json();
    return manifest.datasets.every((d) => /synthetic demo/i.test(d.source?.label ?? ''));
  });
}

const text = (page, selector) =>
  page.$eval(selector, (el) => el.textContent.trim()).catch(() => null);

const count = (page, selector) => page.$$eval(selector, (els) => els.length);

/** True only if the element is laid out, on screen, and the topmost thing at
 *  its own centre. Visibility alone said yes to links a nav was sitting on. */
async function hitTestable(page, selector) {
  return page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return { ok: false, why: `size ${r.width}×${r.height}` };
    if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) {
      return { ok: false, why: `outside the viewport (${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)} of ${innerWidth}×${innerHeight})` };
    }
    // Sample the corners as well as the centre. Testing the middle alone
    // passed an element whose lower half was under another one — which is
    // exactly how the mode nav and the legal links overlapped on a phone
    // while this check reported both reachable.
    const inset = 2;
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + inset, r.top + inset],
      [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
    ];
    for (const [x, y] of points) {
      const top = document.elementFromPoint(x, y);
      // Only the element itself or something inside it counts. Accepting an
      // ancestor as well would accept `body`, which contains everything —
      // the first draft passed happily under a full-page overlay.
      if (!top || !(el === top || el.contains(top))) {
        const by = top
          ? `${top.tagName.toLowerCase()}${top.className ? `.${top.className}` : ''}`
          : 'nothing';
        return { ok: false, why: `covered by ${by} at ${Math.round(x)},${Math.round(y)}` };
      }
    }
    return { ok: true };
  });
}

/** The source note has to name the publisher, name the licence with a link to
 *  its text, and say the data was changed — DL-DE-BY-2.0 §2 no. 2 and §3,
 *  CC BY 4.0 §3(a). It is a condition, so it is checked in every mode. */
async function assertCredit(page, selector = '.header__source') {
  const credit = await page.$eval(selector, (el) => ({
    text: el.textContent.trim(),
    links: [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    licence: el.querySelector('.header__licence')?.getAttribute('href') ?? null,
  }));
  expect(credit.text.length > 12, `credit is only "${credit.text}"`);
  expect(
    credit.links.some((href) => /^https?:\/\//.test(href ?? '')),
    `credit has no link to the source: "${credit.text}"`,
  );
  expect(
    /^https?:\/\//.test(credit.licence ?? ''),
    `credit names no licence with a link: "${credit.text}"`,
  );
  expect(
    /aggregated|verändert|changed/i.test(credit.text),
    `credit does not say the data was changed: "${credit.text}"`,
  );
  return credit.text;
}

/** Waits for the header to name `label` with nothing streaming behind it.
 *  The title changes on click while the dataset is still loading, so the
 *  loading class is the half that says the switch actually completed.
 *
 *  A crash or a failed load also ends the wait: the caller checks for both
 *  straight afterwards, and reporting "the crash page is up" beats spending
 *  four minutes waiting for a header that has been replaced. */
async function settled(page, label, timeout = 240_000) {
  await page.waitForTimeout(400);
  await page.waitForFunction(
    (wanted) => {
      if (document.querySelector('.unsupported') || document.querySelector('.veil__error')) {
        return true;
      }
      const title = document.querySelector('.header__title');
      const header = document.querySelector('header.header');
      return (
        title?.textContent.trim() === wanted &&
        header !== null &&
        !header.classList.contains('header--loading')
      );
    },
    label,
    { timeout },
  );
  await page.waitForTimeout(600);
}

/** Neither failure page may appear: `.unsupported` is the render boundary
 *  catching a throw, `.veil__error` is a load that never arrived. */
async function assertNoFailurePage(page, where) {
  expect((await count(page, '.unsupported')) === 0, `the crash page is up (${where})`);
  const veilError = await text(page, '.veil__error');
  expect(!veilError, `error veil says "${veilError}" (${where})`);
  expect(pageErrors.length === 0, `uncaught: ${pageErrors.join(' · ')} (${where})`);
}

const SCENARIOS = [
  // ---------------------------------------------------------------- controls
  {
    id: 'controls',
    async run(page) {
      await open(page, 'mode=people');

      await check('controls', 'families', async () => {
        const families = await page.$$eval('.modenav__family', (els) =>
          els.map((el) => ({
            label: el.textContent.trim(),
            active: el.getAttribute('aria-pressed') === 'true',
          })),
        );
        expect(families.length > 0, 'no family buttons');
        expect(
          families.filter((f) => f.active).length === 1,
          `${families.filter((f) => f.active).length} families marked active, want 1`,
        );
        return families.map((f) => f.label).join(', ');
      });

      await check('controls', 'toolbar', async () => {
        for (const [selector, what] of [
          ['.export button[title^="Export"], .export button', 'export'],
          ['.langswitch', 'language switch'],
        ]) {
          expect((await count(page, selector)) > 0, `no ${what} in the toolbar`);
        }
        const buttons = await page.$$eval('.export button', (els) =>
          els.map((el) => el.textContent.trim()),
        );
        for (const wanted of ['Settings']) {
          expect(buttons.includes(wanted), `toolbar has ${buttons.join(', ')}, no ${wanted}`);
        }
        return buttons.join(', ');
      });

      await check('controls', 'pagelinks', async () => {
        const links = await page.$$eval('.pagelinks > *', (els) =>
          els
            .filter((el) => !el.classList.contains('pagelinks__dot'))
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              href: el.getAttribute('href'),
              hidden: el.getAttribute('aria-hidden') === 'true',
              label: el.textContent.trim(),
            })),
        );
        const shown = links.filter((l) => !l.hidden);
        expect(
          shown.some((l) => l.tag === 'button' && l.label.length > 0),
          'no About control',
        );
        for (const href of ['/impressum/', '/datenschutz/']) {
          expect(shown.some((l) => l.href === href), `no link to ${href}`);
        }
        return shown.map((l) => l.label).join(', ');
      });

      await check('controls', 'ladder', async () => {
        const rungs = await page.$$eval('.ladder__rung', (els) =>
          els.map((el) => ({
            name: el.textContent.trim(),
            current: el.getAttribute('aria-current') === 'true',
          })),
        );
        expect(rungs.length >= 2, `${rungs.length} rungs on the ladder, want at least 2`);
        expect(
          rungs.filter((r) => r.current).length === 1,
          `${rungs.filter((r) => r.current).length} rungs marked current, want 1`,
        );
        return rungs.map((r) => r.name).join(' → ');
      });

      await check('controls', 'legend', async () => {
        const title = await text(page, '.legend__title');
        expect(title && title.length > 0, 'the legend has no colour title');
        // The height line is left out where height and colour are the same
        // metric — PEOPLE would otherwise print "Population" twice — so it
        // is checked for being meaningful, not for being there.
        const height = await text(page, '.legend__height');
        expect(height === null || height.length > 0, 'the legend has an empty height line');
        const ends = await page.$$eval('.legend__range > *', (els) =>
          els.map((el) => el.textContent.trim()).filter(Boolean),
        );
        const cats = await count(page, '.legend__cat');
        expect(
          ends.length >= 2 || cats >= 2,
          `the legend shows neither a range nor categories (${ends.length} ends, ${cats} categories)`,
        );
        return ends.length >= 2 ? `${ends[0]} … ${ends[ends.length - 1]}` : `${cats} categories`;
      });

      await check('controls', 'attribution', () => assertCredit(page));

      // Pitfall 29: `document.fonts.check()` answers true before the
      // stylesheet is parsed, because with no face at all the fallback
      // counts as available. Asking whether any face is known first is what
      // makes the answer mean anything.
      await check('controls', 'label-font', async () => {
        const font = await page.evaluate(() => ({
          faces: document.fonts.size,
          labels: document.fonts.check('600 14px Inter'),
          body: document.fonts.check('400 16px Inter'),
        }));
        expect(font.faces > 0, 'the document knows no font faces at all');
        expect(font.labels, 'Inter 600 is not loaded — city labels would draw in the fallback');
        expect(font.body, 'Inter 400 is not loaded');
        return `${font.faces} faces`;
      });

      await check('controls', 'settings-dialog', async () => {
        await page.keyboard.press('s');
        await page.waitForSelector('.dialog__panel.settings', { timeout: 5000 });
        const rows = await count(page, '.settings__row');
        expect(rows >= 6, `the settings dialog has ${rows} rows, want at least 6`);
        const labels = await page.$$eval('.settings__label', (els) =>
          els.map((el) => el.textContent.trim()),
        );
        for (const wanted of ['Shadows', 'Quality', 'City labels', 'Motion']) {
          expect(labels.includes(wanted), `settings has ${labels.join(', ')}, no ${wanted}`);
        }
        await page.keyboard.press('Escape');
        await page.waitForSelector('.dialog__panel.settings', { state: 'detached', timeout: 5000 });
        return `${rows} rows`;
      });

      // A modal that lets Tab wander out is a modal only to a mouse.
      // Wrapped so a failure never hands the next check an open dialog.
      await check('controls', 'dialog-focus', async () => {
        try {
          return await dialogFocusCheck(page);
        } finally {
          if ((await count(page, '.dialog__panel.settings')) > 0) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
          }
        }
      });

      async function dialogFocusCheck(page) {
        await press(page, '.export button >> text="Settings"');
        await page.waitForSelector('.dialog__panel.settings', { timeout: 5000 });
        await page.waitForTimeout(400);
        const inside = await page.evaluate(() => {
          const panel = document.querySelector('.dialog__panel.settings');
          return panel?.contains(document.activeElement) || document.activeElement === panel;
        });
        expect(inside, 'focus did not move into the dialog');
        // Test the behaviour, not the attribute: `inert` is inherited, so it
        // sits on an ancestor and a control inside it carries nothing of its
        // own. What matters is that the control cannot take focus.
        const behindInert = await page.evaluate(() => {
          const behind = document.querySelector('.modenav__family');
          if (!behind) return false;
          behind.focus();
          return document.activeElement !== behind;
        });
        expect(behindInert, 'a control behind the dialog can still take focus');
        // twenty tabs is more controls than the dialog has: if any of them
        // escaped, focus would be outside by now
        for (let i = 0; i < 20; i += 1) await page.keyboard.press('Tab');
        const stillInside = await page.evaluate(() => {
          const panel = document.querySelector('.dialog__panel.settings');
          return panel?.contains(document.activeElement) ?? false;
        });
        expect(stillInside, 'Tab escaped the dialog');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.dialog__panel.settings', { state: 'detached', timeout: 5000 });
        const restored = await page.evaluate(
          () => (document.activeElement?.textContent ?? '').trim(),
        );
        expect(restored === 'Settings', `focus returned to "${restored}", not the opener`);
        return 'trapped, inert, restored';
      }

      await check('controls', 'focus-panel', async () => {
        await page.keyboard.press('f');
        await page.waitForSelector('.focus__panel', { timeout: 5000 });
        expect((await count(page, '.focus__search')) === 1, 'the focus panel has no search field');
        try {
          await page.waitForSelector('.focus__item', { timeout: 25_000 });
        } catch {
          const note = await text(page, '.focus__note');
          throw new Error(`no places to focus — the panel says "${note ?? '(nothing)'}"`);
        }
        const places = await count(page, '.focus__item');
        expect(places >= 16, `${places} places offered, want the 16 states at least`);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.focus__panel', { state: 'detached', timeout: 5000 });
        return `${places} places`;
      });

      await check('controls', 'about-panel', async () => {
        await page.keyboard.press('a');
        await page.waitForSelector('.about__title', { timeout: 15_000 });
        const sections = await count(page, '.about__section');
        expect(sections >= 3, `the About panel has ${sections} sections, want at least 3`);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.about__title', { state: 'detached', timeout: 5000 });
        return `${sections} sections`;
      });

      // The export dialog composes its preview from the live canvas, so it
      // is the one control whose answer depends on the renderer.
      await check('controls', 'export-dialog', async () => {
        await page.keyboard.press('e');
        await page.waitForSelector('.export-dialog', { timeout: 5000 });
        const formats = await count(page, '.export__format');
        expect(formats >= 4, `${formats} export choices, want the formats and qualities`);
        expect((await count(page, '.dialog__primary')) === 1, 'the export dialog has no save button');
        return `${formats} choices`;
      });

      if (GPU) {
        await check('controls', 'export-preview', async () => {
          await page.waitForSelector('.export-dialog__preview img', { timeout: 60_000 });
          const size = await page.$eval('.export-dialog__preview img', (el) => ({
            w: el.naturalWidth,
            h: el.naturalHeight,
          }));
          expect(size.w > 32 && size.h > 32, `the poster preview came back ${size.w}×${size.h}`);
          return `${size.w}×${size.h}`;
        });
      } else {
        skip('controls', 'export-preview', 'needs --gpu: the preview is a real capture');
      }
      await page.keyboard.press('Escape');

      await check('controls', 'no-failure-page', () => assertNoFailurePage(page, 'controls'));
    },
  },

  // ------------------------------------------------------------------- modes
  {
    id: 'modes',
    async run(page) {
      await open(page, 'mode=people');

      // Which dataset is on the machine decides what the nav should offer.
      const onDemoData = await usingDemoData(page);
      const wantModes = onDemoData ? EXPECTED_DEMO_MODES : EXPECTED_MODES;
      const wantTimeModes = onDemoData ? EXPECTED_DEMO_TIME_MODES : EXPECTED_TIME_MODES;

      const families = await page.$$eval('.modenav__family', (els) =>
        els.map((el) => el.textContent.trim()),
      );
      const seen = {};
      const timeModes = [];
      let first = null;

      for (const family of families) {
        // A family that cannot be opened is one finding, not a dead scenario:
        // record it and carry on with the others.
        let modes;
        try {
          await press(page, `.modenav__family >> text="${family}"`);
          await page.waitForTimeout(500);
          modes = await page.$$eval('.modenav__item', (els) =>
            els.map((el) => el.textContent.trim()),
          );
        } catch (err) {
          results.push({
            id: `modes/family-${family.toLowerCase()}`,
            status: 'FAIL',
            note: err.message,
          });
          continue;
        }
        seen[family] = modes;

        for (const label of modes) {
          if (first === null) first = label;
          await check('modes', label.toLowerCase().replace(/\s+/g, '-'), async () => {
            await press(page, `.modenav__item >> text="${label}"`);
            await settled(page, label);
            await assertNoFailurePage(page, label);
            // The nav and the header must agree: between a switch and the
            // matching dataset arriving they are one dataset apart, which is
            // where a mode with no metric in the loaded scene came from.
            const title = await text(page, '.header__title');
            expect(title === label, `nav says "${label}", header says "${title}"`);
            const subtitle = await text(page, '.header__subtitle');
            expect(subtitle && subtitle.length > 0, `"${label}" has no subtitle`);
            // Observe before asserting. With this after the credit check, one
            // unrelated failure emptied the whole timeline inventory and the
            // `timelines` check then reported a second, invented problem.
            if ((await count(page, '.timeline')) > 0) timeModes.push(label);
            await assertCredit(page);
            return null;
          });
        }
      }

      // Back to where it started. Switching away and back is the move the
      // visual check cannot make, and the one that broke.
      await check('modes', 'return-trip', async () => {
        expect(first !== null, 'no modes to return to');
        await press(page, '.modenav__family >> nth=0');
        await page.waitForTimeout(400);
        await press(page, `.modenav__item >> text="${first}"`);
        await settled(page, first);
        await assertNoFailurePage(page, 'return trip');
        return `back on ${first}`;
      });

      await check('modes', 'inventory', async () => {
        const asText = (o) =>
          Object.entries(o)
            .map(([k, v]) => `${k}: ${v.join(', ')}`)
            .join(' | ');
        expect(
          asText(seen) === asText(wantModes),
          `the nav offers\n    ${asText(seen)}\n  expected\n    ${asText(wantModes)}`,
        );
        return asText(seen);
      });

      await check('modes', 'timelines', async () => {
        const got = [...timeModes].sort().join(', ');
        const want = [...wantTimeModes].sort().join(', ');
        expect(got === want, `timelines on [${got}], expected [${want}]`);
        return got;
      });
    },
  },

  // ---------------------------------------------------------------- timeline
  {
    id: 'timeline',
    async run(page) {
      // RAIN has 25 steps and is the better exercise, but it needs the DWD
      // pipeline; the demo's only time mode is CHANGE's two censuses.
      await open(page, 'mode=people');
      await open(page, (await usingDemoData(page)) ? 'mode=change' : 'mode=rain');

      await check('timeline', 'shape', async () => {
        await page.waitForSelector('.timeline', { timeout: 30_000 });
        const years = await page.$$eval('.timeline__year', (els) =>
          els.map((el) => el.textContent.trim()),
        );
        expect(years.length === 2, `${years.length} year labels on the timeline, want 2`);
        expect(
          years.every((y) => /^\d{4}$/.test(y)),
          `the timeline is labelled ${years.join(' → ')}`,
        );
        expect(Number(years[1]) > Number(years[0]), `the timeline runs ${years.join(' → ')}`);
        expect(
          (await count(page, '.timeline__track input[type="range"]')) === 1,
          'the timeline has no slider',
        );
        return years.join(' → ');
      });

      // Keyboard rather than a scripted value: a range input driven from the
      // keyboard fires the same event React listens for, and setting .value
      // by hand does not.
      await check('timeline', 'scrub', async () => {
        const slider = '.timeline__track input[type="range"]';
        await page.focus(slider);
        await page.keyboard.press('Home');
        await page.waitForTimeout(900);
        const at0 = await page.$eval(slider, (el) => ({
          value: Number(el.value),
          says: el.getAttribute('aria-valuetext'),
        }));
        expect(at0.value === 0, `Home left the slider at ${at0.value}`);
        const firstYear = await text(page, '.timeline__year');
        expect(
          at0.says === firstYear,
          `the slider reads out "${at0.says}" at the start, the label says "${firstYear}"`,
        );
        await page.keyboard.press('End');
        await page.waitForTimeout(900);
        const at1 = await page.$eval(slider, (el) => el.getAttribute('aria-valuetext'));
        expect(at1 !== at0.says, `the read-out stayed on "${at1}" from one end to the other`);
        return `${at0.says} → ${at1}`;
      });

      await check('timeline', 'play', async () => {
        const slider = '.timeline__track input[type="range"]';
        await page.focus(slider);
        await page.keyboard.press('Home');
        await page.waitForTimeout(400);
        await press(page, '.timeline__play');
        const playing = await page.$eval('.timeline__play', (el) =>
          el.getAttribute('aria-label'),
        );
        expect(playing === 'Pause', `pressing play labelled the button "${playing}"`);
        await page.waitForTimeout(1500);
        const moved = await page.$eval(slider, (el) => Number(el.value));
        expect(moved > 0, 'play did not move the timeline');
        // A two-step sweep (CHANGE) can finish inside that wait and reset
        // itself; clicking then would start a second run, not stop the first.
        const midway = await page.$eval('.timeline__play', (el) => el.getAttribute('aria-label'));
        if (midway === 'Pause') {
          await press(page, '.timeline__play');
          const stopped = await page.$eval('.timeline__play', (el) =>
            el.getAttribute('aria-label'),
          );
          expect(stopped === 'Play', `pausing labelled the button "${stopped}"`);
        }
        return `ran to ${moved.toFixed(2)}${midway === 'Play' ? ' (swept to the end)' : ''}`;
      });

      await check('timeline', 'no-failure-page', () => assertNoFailurePage(page, 'timeline'));
    },
  },

  // --------------------------------------------------------------- url-flags
  {
    id: 'url-flags',
    async run(page) {
      // Pitfall 10b: the view writer rebuilt the query from the keys it knew
      // and dropped every other one 350 ms after load. `?shadows=0` went with
      // them, the quality check then found no flag, decided shadows were
      // wanted, saw no shadow pass and reloaded — five navigations in six
      // seconds, each one losing the flag that would have stopped it.
      let navigations = 0;
      const countNav = () => {
        navigations += 1;
      };
      await open(page, 'mode=people&quality=mobile&palette=moss');
      page.on('framenavigated', countNav);
      await page.waitForTimeout(4000);

      // Read the query the way the app reads it: the view state is written
      // with its commas percent-encoded, so matching the raw string is a
      // check that passes or fails on the escaping rather than the value.
      const params = () =>
        page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));

      await check('url-flags', 'launch-flags-survive', async () => {
        const q = await params();
        const wanted = { quality: 'mobile', intro: '0', lang: 'en', ...(GPU ? {} : { shadows: '0' }) };
        for (const [key, value] of Object.entries(wanted)) {
          expect(q[key] === value, `${key}=${value} became ${key}=${q[key]}`);
        }
        return Object.keys(q).join(', ');
      });

      // The camera is written to the fragment, not the query: it changes on
      // every pan, and a fragment neither reaches the server nor makes a
      // second indexable URL out of one page. The query keeps what the
      // reader chose.
      await check('url-flags', 'view-is-written', async () => {
        const q = await params();
        expect(q.mode === 'people', `the mode became "${q.mode}"`);
        expect(q.palette === 'moss', `the palette became "${q.palette}"`);
        expect(q.view === undefined, `the camera is still in the query as "${q.view}"`);
        const hash = await page.evaluate(() => location.hash.replace(/^#/, ''));
        const view = hash.split(',').map(Number);
        expect(
          view.length === 5 && view.every(Number.isFinite),
          `the fragment is "${hash}", want five numbers`,
        );
        return hash;
      });

      await check('url-flags', 'no-reload-loop', async () => {
        expect(navigations === 0, `the page navigated ${navigations} times while standing still`);
        return null;
      });

      page.off('framenavigated', countNav);
      await check('url-flags', 'no-failure-page', () => assertNoFailurePage(page, 'url-flags'));
    },
  },

  // ---------------------------------------------------------------- reachable
  {
    id: 'reachable',
    async run(page) {
      // The attribution and the two legal pages have to be readable and
      // clickable in every shape the layout takes. A nav once shipped sitting
      // on top of them, which is visible in a screenshot and invisible to a
      // pixel comparison, because the baseline had moved with it.
      await open(page, 'mode=people');
      const MUST_REACH = [
        ['.header__source', 'the source credit'],
        ['.pagelinks a[href="/impressum/"]', 'the legal notice link'],
        ['.pagelinks a[href="/datenschutz/"]', 'the privacy link'],
        // the nav was reported reachable while its lower edge sat under the
        // legal links on a phone, so it is checked here too
        ['.modenav__families', 'the dataset families'],
        ['.modenav__modes', 'the mode row'],
        ['.legend', 'the legend'],
      ];

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // the layout changes at a breakpoint, and the ladder re-lays itself
        await page.waitForTimeout(900);
        await check('reachable', viewport.id, async () => {
          for (const [selector, what] of MUST_REACH) {
            expect((await count(page, selector)) > 0, `${what} is not on the page`);
            const hit = await hitTestable(page, selector);
            expect(hit.ok, `${what} is not reachable: ${hit.why}`);
          }
          return `${viewport.width}×${viewport.height}`;
        });
      }

      await page.setViewportSize(DESKTOP);
      await check('reachable', 'no-failure-page', () => assertNoFailurePage(page, 'reachable'));
    },
  },

  // -------------------------------------------------------------- boundaries
  {
    id: 'boundaries',
    async run(page) {
      // BKG asks for a clearly visible note with a link to bkg.bund.de
      // whenever its boundaries are drawn. That is both uses: a focused state
      // and the country outline, and only the first one used to say so.
      await open(page, 'mode=people');
      if (await usingDemoData(page)) {
        // scripts/fetch-states.mjs downloads the real BKG outlines; the demo
        // has none, so there is no boundary in use and nothing to credit
        skip('boundaries', 'credit-on-focus', 'demo data has no BKG boundaries');
        skip('boundaries', 'credit-on-outline', 'demo data has no BKG boundaries');
        return;
      }
      await open(page, 'mode=people&focus=state:DE-09');

      await check('boundaries', 'credit-on-focus', async () => {
        await page.waitForSelector('.header__source--extra', { timeout: 60_000 });
        const credit = await assertCredit(page, '.header__source--extra');
        const links = await page.$$eval('.header__source--extra a', (els) =>
          els.map((a) => a.getAttribute('href')),
        );
        expect(
          links.some((href) => (href ?? '').includes('bkg.bund.de')),
          `the boundary credit links ${links.join(', ')}, not bkg.bund.de`,
        );
        return credit;
      });

      await open(page, 'mode=people');

      await check('boundaries', 'credit-on-outline', async () => {
        expect(
          (await count(page, '.header__source--extra')) === 0,
          'a boundary credit is showing with no boundaries in use',
        );
        await page.keyboard.press('s');
        await page.waitForSelector('.dialog__panel.settings', { timeout: 5000 });
        // the outline row's On, not the shadow row's
        const row = '.settings__row:has(.settings__label:text-is("Country outline"))';
        await press(page, `${row} >> text="On"`);
        await page.keyboard.press('Escape');
        try {
          await page.waitForSelector('.header__source--extra', { timeout: 60_000 });
        } finally {
          // settings persist in localStorage; leave the machine as found
          await page.keyboard.press('s');
          await page.waitForSelector('.dialog__panel.settings', { timeout: 5000 });
          await press(page, `${row} >> text="Off"`);
          await page.keyboard.press('Escape');
        }
        return null;
      });

      await check('boundaries', 'no-failure-page', () => assertNoFailurePage(page, 'boundaries'));
    },
  },

  // ------------------------------------------------------------------ touch
  {
    id: 'touch',
    async run(page) {
      // Its own page: the rest of the suite drives a mouse, and this is
      // about what a finger does.
      //
      // Known limit, measured: Chromium's touch emulation dispatches a clean
      // tap, so it does NOT reproduce iOS Safari's rule that the first tap on
      // an element with hover behaviour applies the hover and swallows the
      // click. Reverting the fix for that leaves these checks green. What they
      // do guard is the mechanism — one tap reaches the handler and the mode
      // actually changes — not the Safari quirk itself. That still needs a
      // real device (see the browser matrix in docs/testing.md).
      const browser = page.context().browser();
      const phone = await browser.newPage({
        viewport: { width: 390, height: 660 },
        hasTouch: true,
        isMobile: true,
      });
      try {
        const url = `${BASE}/?mode=rain&lang=en&intro=0${GPU ? '' : '&shadows=0'}`;
        await phone.goto(url, { waitUntil: 'domcontentloaded' });
        await phone.waitForSelector('.veil--hidden, .unsupported', { timeout: 180_000 });
        await phone.waitForTimeout(GPU ? 4000 : 9000);
        const title = () => phone.$eval('.header__title', (el) => el.textContent.trim());

        // The families used to peek on pointerenter, which a touchscreen
        // fires as the first half of a tap: the tap that was meant to change
        // the dataset only previewed it, and nothing moved until the second.
        await check('touch', 'one-tap-switches-family', async () => {
          const before = await title();
          await phone.tap('.modenav__family >> text="Housing"');
          await phone.waitForTimeout(4000);
          const after = await title();
          expect(after !== before, `one tap left the header on "${after}"`);
          expect(after === 'Rent', `Housing opened on "${after}", want its first mode`);
          return `${before} → ${after}`;
        });

        await check('touch', 'one-tap-switches-mode', async () => {
          await phone.tap('.modenav__item >> text="Vacancy"');
          await phone.waitForTimeout(4000);
          const after = await title();
          expect(after === 'Vacancy', `one tap on a mode gave "${after}"`);
          return after;
        });

        await check('touch', 'the-intro-stays-away', async () => {
          const intro = await count(phone, '.atlas--intro');
          expect(intro === 0, 'the opening sequence plays on a phone');
          // it is the sequence that makes the nav inert, so check the effect
          const dead = await phone.evaluate(
            () => getComputedStyle(document.querySelector('.modenav')).pointerEvents === 'none',
          );
          expect(!dead, 'the mode nav is not accepting taps');
          return null;
        });
      } finally {
        await phone.close();
      }
    },
  },

  // ------------------------------------------------------------------ reset
  {
    id: 'reset',
    async run(page) {
      // Reset means the view: back to the country and out of any focused
      // region. It must not throw away the mode or the palette, which are
      // the reader's choices rather than their position.
      await open(page, 'mode=rain&palette=moss&view=13.405,52.520,10.40,58,-18');

      await check('reset', 'returns-to-country', async () => {
        const before = await page.$eval('.ladder__rung--active .ladder__name', (el) =>
          el.textContent.trim(),
        );
        // The camera is over Berlin. Reset has to bring it back to the middle
        // of the country, not merely pull the zoom out over Berlin — which is
        // all a zoom-stop request did.
        const at = () =>
          page.evaluate(() => location.hash.replace(/^#/, '').split(',').map(Number));
        const [lon0] = await at();
        expect(Math.abs(lon0 - 13.4) < 1, `did not start over Berlin (lon ${lon0})`);
        await press(page, '.ladder__reset');
        await page.waitForTimeout(4000);
        const [lon1, lat1, , pitch1] = await at();
        expect(
          Math.abs(lon1 - 10.9) < 1.2 && Math.abs(lat1 - 52.0) < 1.5,
          `reset left the camera at ${lon1},${lat1} — it did not recentre`,
        );
        expect(Math.abs(pitch1 - 58) < 2, `reset left the pitch at ${pitch1}`);
        const after = await page.$eval('.ladder__rung--active .ladder__name', (el) =>
          el.textContent.trim(),
        );
        expect(after === 'Country', `the ladder rests on "${after}", want Country`);
        const title = await text(page, '.header__title');
        expect(title === 'Rain', `reset changed the mode to "${title}"`);
        const q = await page.evaluate(() =>
          Object.fromEntries(new URLSearchParams(location.search)),
        );
        expect(q.palette === 'moss', `reset changed the palette to "${q.palette}"`);
        return `${before} → ${after}`;
      });

      await check('reset', 'clears-focus', async () => {
        await open(page, 'mode=people&focus=state:DE-09');
        await page.waitForFunction(
          () => /·/.test(document.querySelector('.modenav__focus')?.textContent ?? ''),
          undefined,
          { timeout: 60_000 },
        );
        await press(page, '.ladder__reset');
        await page.waitForTimeout(2500);
        const label = await text(page, '.modenav__focus');
        expect(label !== null && !label.includes('·'), `focus still reads "${label}"`);
        expect(
          (await count(page, '.header__source--extra')) === 0,
          'the boundary credit is still up with no boundaries in use',
        );
        return label;
      });

      await check('reset', 'no-failure-page', () => assertNoFailurePage(page, 'reset'));
    },
  },
];

(async () => {
  if (LIST) {
    for (const s of SCENARIOS) console.log(s.id);
    return;
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright missing — run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }

  // Fail on the server before failing on forty assertions that all mean the
  // same thing. `check-picking.cjs` spent a day green against a stranger's
  // dev server and red the moment it stopped.
  try {
    const res = await fetch(BASE, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`no site at ${BASE} (${err.message})`);
    console.error('serve the production build first: npm run build && npm run preview');
    process.exit(1);
  }

  const browser = await chromium.launch({
    args: GPU
      ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11']
      : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: DESKTOP });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });

  const started = Date.now();
  for (const scenario of SCENARIOS) {
    if (ONLY && !ONLY.includes(scenario.id)) continue;
    try {
      await scenario.run(page);
    } catch (err) {
      results.push({ id: `${scenario.id}/*`, status: 'FAIL', note: `scenario stopped: ${err.message}` });
    }
  }
  const elapsed = Math.round((Date.now() - started) / 1000);
  await browser.close();

  let failed = 0;
  for (const r of results) {
    console.log(`${r.status.padEnd(5)} ${r.id}${r.note ? `  ${r.note}` : ''}`);
    if (r.status === 'FAIL') failed += 1;
  }
  if (consoleErrors.length > 0) {
    // reported, not failed: deck and luma log recoverable things, and a dev
    // server adds its own noise on top
    console.log(`\n${consoleErrors.length} console error(s):`);
    for (const line of [...new Set(consoleErrors)].slice(0, 10)) console.log(`  ${line}`);
  }
  if (failed) {
    console.error(`\n${failed} check(s) failed after ${elapsed} s.`);
    process.exit(1);
  }
  console.log(`\n${results.filter((r) => r.status === 'pass').length} checks passed in ${elapsed} s.`);
})();
