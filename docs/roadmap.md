# Roadmap

## Data spike — done

- [x] binary format (positions + metric buffers + manifest)
- [x] manifest builder assembling every pipeline output (`scripts/build-manifest.mjs`)
- [x] rendering proof: `prototype/` → `docs/media/hero-people.png`
- [x] real census data through `pipelines/zensus`: population 2022 + 2011,
      mean age, homes, rent, heating energy source (sums verified against
      the published totals; suppressed cells stay missing)

## Visual hero — done

- [x] paper canvas, hex overlap, linear heights with p99.5 calibration,
      isometric camera (58/−18/24), lighting, switchable colour ramps
- [ ] fine-tune shadows and label density against real data

## Product shell — done

- [x] React/Vite shell, mode navigation, tooltip, legend with palette picker,
      URL state (`?mode=&t=&palette=&view=`), attribution, loading as a growth
      animation

## Census metric engine — in progress

- [x] aggregation rules (tested), mode contract, mode morph
- [x] AGE / RENT / HEATING as modes, on real census data
- [x] weighted-mean and category metrics in the pipeline CLI
- [x] share metrics in the pipeline CLI (vacancy, share ≥65)
- [x] FAMILIES / HOMES / VACANCY on real census data (household size,
      share built 2014+, dwelling-weighted vacancy rate)

## Change — in progress

- [x] delta metric with small-denominator suppression, diverging scale,
      timeline slider with play, height mix 2011↔2022
- [x] census 2011 import (80.26 M, aligned to the 2022 cell universe)
- [x] GPU morph: both endpoints as attributes, one uniform per frame

## Multi-LOD — in progress

- [x] r9 tiling by H3 parent, viewport tile index with
      bounds, worker-side decode and colour mapping, zoom crossfade,
      prefetch ring, LRU tile cache
- [x] per-LOD metric stats: p99.5 at r7 is 21k people, at r8 4.8k, at r9
      1.2k — one shared stat block flattened whichever LOD it did not
      belong to
- [ ] r10 tiles in the app (writer supports it via `--write-r10`)
- [ ] picking/tooltip on fine tiles; per-tile fade-in polish

## Further sources — open

- [x] AFTER DARK: `pipelines/black-marble` turns NASA Black Marble into H3
      cells (mean radiance per year, clipped to the outline) — the VNP46A4
      annual composites 2012–2025 with a timeline; the app switches
      datasets per mode, proving the renderer is not a census viewer
- [x] WIND: `pipelines/mastr` range-reads the wind units out of the
      Marktstammdatenregister export and writes installed MW per cell and
      year since 1990; the timeline plays the build-up, offshore included
- [x] RAIN: `pipelines/dwd` turns the DWD's 1 km annual precipitation
      grids into H3 cells and years; the timeline plays wet years against
      dry ones, and `zeroAt` keeps the field a relief instead of a slab
- [x] LAND: `pipelines/clc5` reads BKG's CORINE Land Cover 5 ha straight
      out of the GeoPackage (SQLite + WKB, no GDAL), covers every polygon
      with H3 cells and writes the artificial share and the dominant cover
      per cell. 2021 is in; the older vintages are shapefiles, and with two
      of them loaded the mode gains a timeline of sealing
- [ ] FOREST (Thünen / Copernicus): forest extent, species and disturbance

## Cinematic polish — in progress

- [x] 4K poster export (EXPORT button / E key: captured from the live view,
      composed with title, legend and attribution)
- [x] soft shadows in the app: deck's shadow pass works once texture-using
      layers (labels, outline) opt out with `shadowEnabled: false`; a single
      stable LightingEffect avoids stale pipeline bindings. `?shadows=0`
      disables them for software renderers.
- [x] needle silhouettes, peak-anchored height calibration, ambient
      occlusion, thin plinth, MSAA — calibrated in the prototype
- [x] camera fits the dataset bounds to the viewport, so the sculpture fills
      the frame at any window size (fixed zoom cropped or shrank it)
- [x] camera stories per mode (plan §98) — curated flights between named
      places, e.g. CHANGE: Munich → Leipzig → Lusatia
- [x] social export formats 16:9 / 4:5 / 1:1 / 9:16, type scaled to the
      frame; portrait crops turn the camera so the country lies diagonally

## Production — in progress

- [x] CI (typecheck, tests, build), Dependabot, Cloudflare Pages config
      with cache headers
- [x] **mobile quality profile**: r7 country LOD (68k cells instead of
      272k), shadows off, DPR capped at 1.5, tier-1 labels only, no tile
      streaming. `?quality=mobile|desktop` forces either. Attribution now
      stays visible on small screens — the Destatis and NASA terms make the
      credit a licence condition.
- [ ] browser/GPU matrix, visual regression
