# Testing

## Automated

```bash
npm run lint           # eslint over app, packages and scripts
npm run typecheck      # packages + app
npm run test           # node:test (packages) + unittest (zensus, black-marble, mastr, dwd pipelines)
npm run build
```

The browser-driven checks below need pipeline data in `apps/web/public/data`
and therefore do not run in CI; the README says so too.

Hover picking (deck.gl 9.1 is pinned because 9.3 broke it):

```bash
PICK_GPU=1 PICK_WAIT_MS=12000 node scripts/check-picking.cjs   # headless Chromium on the GPU
PICK_WAIT_MS=25000 node scripts/check-picking.cjs              # SwiftShader (CI)

# The URL is the first argument and defaults to the dev server on :5173.
# Point it at the production build instead when that is what you are testing —
# a missing dev server fails with ERR_CONNECTION_REFUSED, and piping the
# command through `tail` hides that, because a pipeline reports the exit code
# of its last stage.
node scripts/check-picking.cjs "http://localhost:4173/?mode=people"
```

## Interface suite (local)

Drives the atlas the way a visitor drives it and asserts that the controls are
there, answer, and do not break the sculpture. It needs the real data and a
served build, so it is a local gate like the picking and visual checks
around it:

```bash
npm run build && npm run preview     # production build on :4173
npm run ui                           # 45 checks, about a minute on a GPU
```

Options: `--url http://localhost:4173`, `--only modes,timeline`, `--list`,
and without `--gpu` it runs under SwiftShader with `?shadows=0` (slower, and
the poster preview is skipped).

It is the counterpart to the visual check, not a replacement. That one
compares pixels and cannot see text, small controls, or anything that only
happens *between* two states; this one reads the DOM and cannot see how any
of it looks. Run both. What each scenario is for:

| Scenario | Watches |
| --- | --- |
| `controls` | every control is present and answers: nav, toolbar, ladder, legend, the four dialogs, and that Inter 600 actually loaded — city labels silently drew in the fallback once |
| `modes` | clicks every mode of every family in turn, which crosses datasets six times. A render throw on a dataset switch reports as `the crash page is up`. Also compares the nav's inventory and its timelines against what is expected here |
| `timeline` | two year labels, a slider that reads out the year it is on, and play that moves it |
| `url-flags` | `?quality=`, `?shadows=0`, `?lang=` and `?intro=` survive the view writer, and the page does not reload itself |
| `reachable` | the source credit and both legal links are hit-tested at four viewport shapes — not merely visible, but the topmost thing at their own centre |
| `boundaries` | the BKG credit appears for both uses of the boundaries, a focused state and the country outline, and links `bkg.bund.de` |

Two lists in the script are deliberate tripwires: `EXPECTED_MODES` and
`EXPECTED_TIME_MODES`. A mode that quietly stops being served leaves no other
trace in the interface, so adding one means editing those lists — the same
way a visual baseline is accepted on purpose rather than by default.

The suite has been falsified: covering the legal links, removing the licence
from the source note, moving a mode to another family and throwing on a
dataset switch each produce a failure that names the cause. A check that has
never failed is not known to work.

## Visual regression (local)

The data folder is generated and not in the repo, so screenshots cannot be
compared in CI. Locally, with `npm run dev` running:

```bash
npm run visual:update    # accept the current look as the baseline (.visual/, git-ignored)
npm run visual           # every mode, mobile profile, a city zoom and a focus view; exit 1 on change
```

Each view is captured at 1400 × 900 with `?intro=0`; `.visual/diff/*.png`
shows what moved. `--threshold 0.5` (percent of pixels) is the default;
`--only people,wind` restricts the run; without `--gpu` it uses SwiftShader
and `?shadows=0`.

## Browser / GPU matrix

What the app needs: WebGL2, `OffscreenCanvas` not required, Web Workers,
`sessionStorage`/`localStorage` (optional). Checked by hand with the real
data:

| Browser | Status | Notes |
| --- | --- | --- |
| Chrome / Edge, Windows, discrete GPU | ✓ | development target; all checks above |
| Chromium headless, D3D11 | ✓ | `PICK_GPU=1`, `npm run visual` |
| Chromium headless, SwiftShader | partial | renders with `?shadows=0`; on some machines the first frame takes >25 s |
| Firefox desktop | untested here | playwright's Firefox 153 will not start in this environment (`spawn UNKNOWN`, "corrupted shared library"), so the check has to run on a real desktop: open the app, confirm shadows, hover tooltip, a timeline scrub and a story flight |
| Safari macOS / iOS | untested | WebGL2 since Safari 15; the mobile quality profile (r7, no shadows) is what a phone gets |
| Chrome Android | untested | `?quality=mobile` reproduces the profile on desktop |

Things to look at on a new browser: shadows present at country zoom, hover
tooltip, the timeline scrub in CHANGE/WIND, a story flight (no blank
frames), the fine tiles at a city zoom, and that the attribution is visible.
