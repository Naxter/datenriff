# Testing

## Automated

```bash
npm run typecheck      # packages + app
npm run test           # node:test (packages) + unittest (zensus, black-marble, mastr, dwd pipelines)
npm run build
```

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
