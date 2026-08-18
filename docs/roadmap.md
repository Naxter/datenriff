# Roadmap

## Data spike — done (with demo data)

- [x] binary format (positions + metric buffers + manifest)
- [x] deterministic demo generator (~486k cells)
- [x] rendering proof: `prototype/` → `docs/media/hero-people.png`
- [ ] real census 2022 data through `pipelines/zensus` (the SUM path is
      finished, it needs the multi-gigabyte CSVs from Destatis)

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
- [x] AGE / RENT / HEATING as modes (demo data)
- [x] weighted-mean and category metrics in the pipeline CLI
- [x] share metrics in the pipeline CLI (vacancy, share ≥65)
- [ ] FAMILIES / HOMES / VACANCY (ETL + mode definition only)

## Change — in progress

- [x] delta metric with small-denominator suppression, diverging scale,
      timeline slider with play, height mix 2011↔2022
- [ ] census 2011 import (pipeline run), GPU morph instead of CPU

## Multi-LOD — open

- [ ] r9/r10 tiling by H3 parent, viewport tile index, crossfade (the alpha
      channel of the colour buffer is reserved for it), prefetch, worker

## Further sources — open

- [ ] pipelines for night lights, precipitation, energy registry, land cover
      and forest (the `afterdark`/`rain`/`energy` palettes are prepared)

## Cinematic polish — open

- [ ] GPU morph shader, camera stories, 4K poster export, social formats

## Production — open

- [ ] CDN + Brotli + hashed assets, browser/GPU matrix, mobile profiles
      (r7 country), visual regression
