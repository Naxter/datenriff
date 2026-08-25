// One ColumnLayer with binary GPU attributes renders every cell; a faint
// country outline and a handful of city labels are the only other layers —
// no basemap. The morph engine's buffers are re-uploaded only on frames
// where they actually changed.
//
// deck.gl is pinned to 9.1.x on purpose: in 9.3.10 the picking pass writes
// nothing into its offscreen framebuffer, so hover picking never returns a
// cell. Verify picking after any deck.gl upgrade.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import {
  FlyToInterpolator,
  MapView,
  WebMercatorViewport,
  type MapViewState,
  type PickingInfo,
} from '@deck.gl/core';
import { ColumnLayer } from '@deck.gl/layers';
import { nearestStop, stepStop, type MorphEngine } from '@datenriff/sculpture-core';
import type { SceneData } from '../data/loader';
import { getMode } from '../modes/modes';
import { useAtlasStore } from '../state/store';
import { readUrlState, writeUrlState } from '../state/url';
import {
  CAMERA_FOVY,
  DENSITY_HEIGHT_FALLOFF,
  HEIGHT_FALLOFF,
  INITIAL_VIEW_STATE,
  cameraStops,
  fitViewState,
  pitchForFrame,
  type ViewInsets,
  zoomHeightScale,
} from './camera';
import {
  CAPTURE_EVENT,
  currentDpr,
  captureIsPending,
  currentFormat,
  deliverCapture,
} from './exportBridge';
import { createLighting, tuneLighting } from './lighting';
import { labelTierCap, shadowPassPossible, shadowsEnabled } from './quality';
import { loadOutline } from '../data/focusData';

/** '#221c15' -> [34, 28, 21]; the settings keep the colour as CSS hex so a
 *  colour input can edit it directly. */
function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
import { resolveReducedMotion } from '../state/settings';
import {
  createColumnLayer,
  createSculptureLayers,
  labelCharacterSet,
  labelFaceReady,
  sculptureRadius,
} from './layers';
import type { FadeBox } from './morphColumnLayer';
import { heightIsCount } from './targets';
import { TileManager, tileZone } from './tiles';
import { focusBounds, focusKey } from './focus';

/** How long a step between camera stops takes, and how long a stop holds
 *  before the next wheel notch is read. Without the cooldown one flick of a
 *  trackpad would run through every stop. */
const STEP_MS = 700;
const STEP_COOLDOWN_MS = 380;
/** Zoom a pinch has to end more than this far from a stop to be pulled in. */
const SNAP_EPSILON = 0.05;

/** How long the country layer takes to hand over to the fine tiles, in ms.
 *  The handover used to be spread over half a zoom level, which meant every
 *  zoom in that band drew both layers at once — the same place as a coarse
 *  cone and as a fine needle, side by side, which reads as a fault rather
 *  than as detail. It is a moment now, not a place you can stand in.
 *
 *  Long enough to be watched rather than blinked past: the fine cells rise
 *  out of the coarse height over this window (see the fine layer's
 *  elevationScale), so the change reads as detail unfolding. */
const HANDOVER_MS = 620;
/** Tile coverage of the zone at which the fine tiles take over, and the
 *  level it has to fall back to before the country layer returns. The gap
 *  is hysteresis: panning briefly wants tiles that have not arrived, and
 *  without it the two layers would trade places on every pan. */
const COVERAGE_ENTER = 0.92;
const COVERAGE_LEAVE = 0.55;
/** Minimum spacing between tile queries while the camera moves. */
const TILE_QUERY_MS = 250;

/** How long a replaced dataset's sculpture takes to sink into the plane. */
const OUTGOING_MS = 950;


interface Props {
  scene: SceneData;
  engine: MorphEngine;
}

/** The previous dataset's sculpture while it sinks away. */
interface Outgoing {
  scene: SceneData;
  engine: MorphEngine;
  radius: number;
}

/** Camera transition props, or none at all.
 *
 *  Reduced motion was honoured by the morphs, the timeline and the intro,
 *  but not by the camera: every zoom stop, focus flight, story stop and
 *  reset still swept across the country. A flight is the largest movement
 *  the page makes, so it is the one that matters most here. */
function flight(reduced: boolean, ms: number, speed: number, curve?: number) {
  if (reduced) return { transitionDuration: 0 };
  return {
    transitionDuration: ms,
    transitionInterpolator: new FlyToInterpolator(curve ? { speed, curve } : { speed }),
  };
}

/** A mode or a story may ask for a steeper angle than the frame can carry;
 *  on a portrait phone the cap keeps the country filling the screen. */
const framePitch = (pitch: number) => ({
  pitch: pitchForFrame(pitch, window.innerWidth, window.innerHeight),
});

/** How much of the screen the interface is covering, top and bottom.
 *
 *  Read from the DOM rather than assumed: the credit grows a second line
 *  whenever the country outline is on, and a layout guessed at from constants
 *  put the south of the country behind the legend for exactly that reason. */
function chromeInsets(): ViewInsets {
  // 760 px is the CSS breakpoint. Above it the interface is corner-anchored
  // and its wrappers are `display: contents`, which have no box at all — an
  // aspect-ratio test disagreed with the stylesheet and measured those zeros
  // as a full-height inset, which crashed the fit on a portrait tablet.
  if (!window.matchMedia?.('(max-width: 760px)').matches) return { top: 0, bottom: 0 };
  const top = document.querySelector('.topblock')?.getBoundingClientRect().bottom ?? 0;
  const bar = document.querySelector('.bottombar')?.getBoundingClientRect().top;
  return {
    top: Math.max(0, Math.round(top)),
    bottom: bar === undefined ? 0 : Math.max(0, Math.round(window.innerHeight - bar)),
  };
}

/** A portrait frame is where the camera is fixed: the same condition that
 *  flattens the pitch, so the two never disagree about what kind of frame
 *  this is. */
function isPortrait(): boolean {
  // same breakpoint as the stylesheet: the fixed camera belongs with the
  // phone layout, not with an aspect ratio that can disagree with it
  return (window.matchMedia?.('(max-width: 760px)').matches ?? false) &&
    window.innerWidth / window.innerHeight < 1;
}

export function SculptureView({ scene, engine }: Props) {
  const [fixedCamera, setFixedCamera] = useState(isPortrait);
  useEffect(() => {
    const onResize = () => setFixedCamera(isPortrait());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  // A fixed camera has to be re-composed when the frame changes shape —
  // turning the phone would otherwise leave the previous fit in place.
  const refit = useCallback(() => {
    setViewState((v) => ({
      ...v,
      ...fitViewState(scene.lod.bounds, window.innerWidth, window.innerHeight, chromeInsets()),
    }));
  }, [scene.lod.bounds]);
  useEffect(() => {
    if (!fixedCamera) return;
    refit();
    window.addEventListener('resize', refit);
    // …and whenever the interface changes height. Switching the country
    // outline on adds a second credit line, a longer mode title wraps, and
    // either would leave the country fitted to a band that no longer exists —
    // which is how the south of it ended up behind the legend.
    const observer = new ResizeObserver(() => refit());
    for (const selector of ['.topblock', '.bottombar']) {
      const el = document.querySelector(selector);
      if (el) observer.observe(el);
    }
    return () => {
      window.removeEventListener('resize', refit);
      observer.disconnect();
    };
  }, [fixedCamera, refit]);

  const setHover = useAtlasStore((s) => s.setHover);
  const setView = useAtlasStore((s) => s.setView);
  const modeId = useAtlasStore((s) => s.modeId);
  const timeT = useAtlasStore((s) => s.timeT);
  const palette = useAtlasStore((s) => s.palette);
  const sculptureVersion = useAtlasStore((s) => s.sculptureVersion);
  const storyStop = useAtlasStore((s) => s.storyStop);

  const quality = useAtlasStore((s) => s.quality);
  const settings = useAtlasStore((s) => s.settings);
  // the border outline arrives only if someone switches the border on
  const manifest = useAtlasStore((st) => st.manifest);
  const [borderRings, setBorderRings] = useState<[number, number][][] | null>(null);
  useEffect(() => {
    if (!settings.border || !manifest || borderRings) return;
    void loadOutline(manifest).then(setBorderRings);
  }, [settings.border, manifest, borderRings]);

  const [viewState, setViewState] = useState<MapViewState>(() => {
    const shared = readUrlState().view;
    // a shared URL wins; otherwise fit the country to this window
    if (shared) return { ...INITIAL_VIEW_STATE, ...shared };
    return fitViewState(scene.lod.bounds, window.innerWidth, window.innerHeight, chromeInsets());
  });
  const [exporting, setExporting] = useState(false);
  const deckRef = useRef<{ deck?: { canvas?: HTMLCanvasElement | null } } | null>(null);
  // The poster frame has its own aspect, so it gets its own fit: same
  // angles as the live view, position and zoom fitted to 16:9.
  const exportView = useRef<MapViewState | null>(null);

  // poster capture: resize the deck to the poster frame for one frame,
  // copy, restore
  useEffect(() => {
    const onCapture = () => {
      exportView.current = null; // resolved lazily from the live viewState
      setExporting(true);
    };
    window.addEventListener(CAPTURE_EVENT, onCapture);
    return () => window.removeEventListener(CAPTURE_EVENT, onCapture);
  }, []);

  // A dataset switch hands in a new scene and engine. The old sculpture is
  // kept as `outgoing` and sunk back into the plane while the new one grows
  // (App starts that growth), so the two cross-morph instead of the frame
  // going blank. Reduced motion skips the sink and just drops the old one.
  const reducedMotion = useMemo(() => resolveReducedMotion(settings), [settings]);
  const outgoingRef = useRef<Outgoing | null>(null);
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const [outgoingMix, setOutgoingMix] = useState(0);
  const previous = useRef<{ scene: SceneData; engine: MorphEngine }>({ scene, engine });
  useEffect(() => {
    const prev = previous.current;
    if (prev.engine === engine) return;
    previous.current = { scene, engine };
    if (reducedMotion || prev.engine.isPristine) {
      outgoingRef.current = null;
      setOutgoing(null);
      return;
    }
    prev.engine.fadeOut(performance.now(), OUTGOING_MS);
    const out = { scene: prev.scene, engine: prev.engine, radius: sculptureRadius(prev.scene) };
    outgoingRef.current = out;
    setOutgoing(out);
    setOutgoingMix(0);
  }, [scene, engine, reducedMotion]);

  // Advance the blends. Only `mixAmount` changes per frame — the attribute
  // buffers stay put, so this re-renders without re-uploading anything.
  const [mixAmount, setMixAmount] = useState(1);
  const shownMix = useRef(1);
  // Country layer → fine tiles: `fineWanted` is decided during render from
  // tile coverage, `fineMix` eases there over HANDOVER_MS.
  const [fineMix, setFineMix] = useState(0);
  const fineWanted = useRef(false);
  const fineUsableRef = useRef(false);
  const fineMixRef = useRef(0);
  const lastFrame = useRef(0);
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      engine.tick(now);
      const dt = lastFrame.current ? now - lastFrame.current : 0;
      lastFrame.current = now;
      const target = fineWanted.current ? 1 : 0;
      let next = fineMixRef.current;
      if (!fineUsableRef.current) {
        // No fine layer to fade any more (zoomed out past its level, or a
        // scrub): easing here would fade the country layer *in* over an
        // empty near field — a hole, not a handover.
        next = 0;
      } else if (next !== target && dt > 0) {
        const step = dt / HANDOVER_MS;
        next =
          target > next ? Math.min(target, next + step) : Math.max(target, next - step);
      }
      if (next !== fineMixRef.current) {
        fineMixRef.current = next;
        setFineMix(next);
      }
      // transitions and timeline scrubs both move only this uniform
      if (engine.mixAmount !== shownMix.current) {
        shownMix.current = engine.mixAmount;
        setMixAmount(engine.mixAmount);
      }
      const out = outgoingRef.current;
      if (out) {
        if (out.engine.tick(now)) {
          setOutgoingMix(out.engine.mixAmount);
        } else if (!out.engine.isAnimating) {
          outgoingRef.current = null; // sunk completely; release its buffers
          setOutgoing(null);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // Fine-LOD tiles, loaded viewport-driven in a worker. The manager owns a
  // Worker, so it is created in the effect — StrictMode's mount/unmount
  // cycle would otherwise terminate the worker of a memoized instance.
  const [tilesVersion, setTilesVersion] = useState(0);
  const [tileManager, setTileManager] = useState<TileManager | null>(null);
  useEffect(() => {
    const manager = new TileManager(scene);
    manager.onChange = () => setTilesVersion((v) => v + 1);
    setTileManager(manager);
    return () => {
      manager.destroy();
      setTileManager((current) => (current === manager ? null : current));
    };
  }, [scene]);

  const mode = getMode(modeId, scene.dataset);

  // Each mode is composed for an angle. On mode switch the camera eases
  // there (deck's FlyTo-style transition) unless the URL pinned a view.
  const pinnedView = useRef(readUrlState().view !== undefined);
  const lastCameraMode = useRef<string | null>(null);
  useEffect(() => {
    if (lastCameraMode.current === null) {
      lastCameraMode.current = modeId;
      if (!pinnedView.current && mode.camera && !fixedCamera) {
        const cam = mode.camera;
        setViewState((v) => ({ ...v, ...cam, ...framePitch(cam.pitch ?? v.pitch ?? 0) }));
      }
      return;
    }
    if (lastCameraMode.current === modeId) return;
    lastCameraMode.current = modeId;
    // the composed view is the view: a mode does not get to re-aim it
    if (fixedCamera) return;
    pinnedView.current = false;
    const target = mode.camera ?? { pitch: INITIAL_VIEW_STATE.pitch, bearing: INITIAL_VIEW_STATE.bearing };
    setViewState((v) => ({
      ...v,
      ...target,
      ...framePitch(target.pitch ?? v.pitch ?? 0),
      ...flight(reducedMotion, 900, 1.4),
    }));
  }, [modeId, mode.camera, reducedMotion, fixedCamera]);

  // a new focus flies the camera to its region (mode angles kept)
  const focus = useAtlasStore((s) => s.focus);
  const lastFocusKey = useRef<string | null>(null);
  useEffect(() => {
    const key = focusKey(focus);
    if (lastFocusKey.current === null) {
      lastFocusKey.current = key;
      if (!focus) return;
    }
    if (lastFocusKey.current === key) return;
    lastFocusKey.current = key;
    const bounds = focus ? focusBounds(focus) : scene.lod.bounds;
    const fit = fitViewState(bounds, window.innerWidth, window.innerHeight, chromeInsets());
    setViewState((v) => ({
      ...v,
      longitude: fit.longitude,
      latitude: fit.latitude,
      // a state fills the frame; a city radius fits loosely
      zoom: focus?.kind === 'city' ? fit.zoom - 0.4 : fit.zoom,
      ...flight(reducedMotion, 1400, 1.3),
    }));
  }, [focus, scene.lod.bounds, reducedMotion]);

  // camera stories fly the view to each stop in turn
  useEffect(() => {
    if (!storyStop) return;
    setViewState((v) => ({
      ...v,
      longitude: storyStop.longitude,
      latitude: storyStop.latitude,
      zoom: storyStop.zoom,
      ...framePitch(storyStop.pitch ?? v.pitch ?? 0),
      bearing: storyStop.bearing ?? v.bearing,
      ...flight(reducedMotion, 2200, 1.2, 1.3),
    }));
  }, [storyStop, reducedMotion]);

  // Where the country comes to rest in *this window* — the live one, not the
  // poster frame, since this decides what gets streamed while someone looks.
  const [frameKey, setFrameKey] = useState(0);
  useEffect(() => {
    const onResize = () => setFrameKey((k) => k + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const liveCountryZoom = useMemo(
    () =>
      fitViewState(scene.lod.bounds, window.innerWidth, window.innerHeight, chromeInsets()).zoom,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene.lod.bounds, frameKey],
  );

  const fineLod = tileManager?.activeLod(viewState.zoom, liveCountryZoom) ?? null;
  const fineUsable =
    tileManager !== null &&
    fineLod !== null &&
    timeT >= 1 &&
    tileManager.supportsMode(fineLod, mode);
  // The fine tiles cover the near field of the frame (`tileZone`); the far
  // field stays with the country LOD. The country columns inside the zone
  // step aside only as far as the tiles have actually arrived (coverage):
  // fading them on zoom alone left bare paper where tiles were still
  // decoding — most visible when a camera story flew straight to a city.
  const zoneInfo = useMemo(
    () => tileZone(viewState, window.innerWidth, window.innerHeight),
    [viewState],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const coverage = useMemo(() => tileManager?.coverage() ?? 0, [tileManager, tilesVersion]);
  // Who owns the near field: the fine tiles once they cover it, the country
  // layer until then. Readiness decides, not zoom — the tiles are the truth
  // about a place as soon as they are all there.
  fineUsableRef.current = fineUsable;
  fineWanted.current =
    fineUsable &&
    coverage >= (fineMix > 0.5 ? COVERAGE_LEAVE : COVERAGE_ENTER);
  const fineOpacity = fineUsable ? fineMix : 0;
  const fadeBox: FadeBox | null =
    fineOpacity > 0
      ? {
          bounds: [
            zoneInfo.zone[0] + zoneInfo.feather[0],
            zoneInfo.zone[1] + zoneInfo.feather[1],
            zoneInfo.zone[2] - zoneInfo.feather[0],
            zoneInfo.zone[3] - zoneInfo.feather[1],
          ],
          margin: zoneInfo.feather,
          opacity: 1 - fineOpacity,
        }
      : null;

  // Throttled, not debounced: a camera flight moves the view every frame,
  // and a debounce would postpone every tile request until it has landed.
  // Firing every ~250 ms lets the destination's tiles start streaming while
  // the camera is still descending.
  const lastTileQuery = useRef(0);
  useEffect(() => {
    if (!fineUsable || !tileManager || !quality.streamTiles) return;
    const run = () => {
      lastTileQuery.current = performance.now();
      tileManager.update({
        ...zoneInfo,
        zoom: viewState.zoom,
        countryZoom: liveCountryZoom,
        mode,
        palette,
        region: focus,
        enabled: true,
      });
    };
    const wait = Math.max(0, TILE_QUERY_MS - (performance.now() - lastTileQuery.current));
    const timer = setTimeout(run, wait);
    return () => clearTimeout(timer);
  }, [tileManager, fineUsable, zoneInfo, viewState.zoom, mode, palette, focus, quality.streamTiles, liveCountryZoom]);

  useEffect(() => {
    writeUrlState(modeId, timeT, palette, viewState, focusKey(focus) || null);
    setView(viewState);
  }, [modeId, timeT, palette, viewState, focus, setView]);

  const radius = sculptureRadius(scene);

  // country cell nearest to a fine cell (place name, fallback values); a
  // linear scan over 272k positions is ~1 ms, fine for a hover
  const nearestCountryCell = useMemo(
    () => (lon: number, lat: number) => {
      const p = scene.positions;
      const kx = Math.cos((lat * Math.PI) / 180);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < scene.count; i++) {
        const dx = (p[2 * i]! - lon) * kx;
        const dy = p[2 * i + 1]! - lat;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    [scene],
  );

  // The poster is its own frame: the whole country, fitted to the format,
  // not wherever the camera happens to stand. Everything downstream has to
  // follow *that* view — the heights above all. Reading the live camera
  // while rendering the poster frame put the country on paper with a city's
  // height falloff, which is to say flat.
  const exportFormat = exporting ? currentFormat() : null;
  if (exportFormat && !exportView.current) {
    // Germany is wider than it is tall, so a portrait crop would leave it
    // small between two empty bands. Turning the camera lays the country
    // diagonally across the frame instead.
    const portrait = exportFormat.width / exportFormat.height < 0.9;
    exportView.current = {
      ...fitViewState(scene.lod.bounds, exportFormat.width, exportFormat.height),
      pitch: viewState.pitch,
      bearing: (viewState.bearing ?? 0) - (portrait ? 25 : 0),
    };
  }
  const renderView = exportFormat && exportView.current ? exportView.current : viewState;
  const renderWidth = exportFormat ? exportFormat.width : window.innerWidth;
  const renderHeight = exportFormat ? exportFormat.height : window.innerHeight;

  // columns ease down in height as the camera closes in past the country
  // framing (a 100 km needle would otherwise fill a city frame). Where the
  // fine levels carry a count per unit area they rise steeply with detail,
  // so those modes ease down faster — see DENSITY_HEIGHT_FALLOFF.
  const countryZoom = fitViewState(scene.lod.bounds, renderWidth, renderHeight).zoom;
  // The falloff follows what is drawn, not what is chosen: while a new
  // dataset streams, the chosen mode is already the new one and the sculpture
  // sinking into the plane is still the old one. Keeping the last answer that
  // belonged to this scene stops those columns from jumping to eight times
  // their height on the way out.
  const perAreaHeight = useRef(false);
  const isCount = scene.tileLods.length > 0 ? heightIsCount(scene, mode) : false;
  if (isCount !== null) perAreaHeight.current = isCount;
  const heightScale = zoomHeightScale(
    renderView.zoom ?? viewState.zoom,
    countryZoom,
    perAreaHeight.current ? DENSITY_HEIGHT_FALLOFF : HEIGHT_FALLOFF,
  );

  // Snapped camera. The wheel and a double click step between composed stops
  // instead of zooming freely: every frame the reader can come to rest in
  // belongs to one level of detail, framed on purpose. Touch keeps its pinch
  // — swallowing that gesture feels broken — and is pulled to the nearest
  // stop when it ends. Shared links, focus flights and camera stories name
  // their own zoom and are left alone.
  const stops = useMemo(() => cameraStops(countryZoom), [countryZoom]);
  const cameraRef = useRef<{ view: MapViewState; stops: number[] }>({ view: viewState, stops });
  cameraRef.current = { view: viewState, stops };
  const lastStepAt = useRef(0);
  const stepCamera = useCallback((dir: 1 | -1, pointer?: [number, number]) => {
    const now = performance.now();
    if (now - lastStepAt.current < STEP_COOLDOWN_MS) return;
    const { view, stops: list } = cameraRef.current;
    const from = view.zoom ?? 0;
    const zoom = stepStop(list, from, dir);
    if (zoom === from) return;
    lastStepAt.current = now;
    let { longitude, latitude } = view;
    if (dir > 0 && pointer) {
      // step towards what the reader pointed at, the way a map does
      const vp = new WebMercatorViewport({
        ...view,
        width: window.innerWidth,
        height: window.innerHeight,
      });
      const [lng, lat] = vp.unproject(pointer);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        longitude = lng!;
        latitude = lat!;
      }
    }
    setViewState((v) => ({
      ...v,
      longitude,
      latitude,
      zoom,
      ...flight(reducedMotion, STEP_MS, 1.4),
    }));
  }, [reducedMotion]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    // not passive: the page would otherwise scroll and the browser zoom
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 2) return;
      stepCamera(e.deltaY < 0 ? 1 : -1, [e.clientX, e.clientY]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stepCamera, fixedCamera]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement;
      if (typing) return;
      if (fixedCamera) return;
      if (e.key === '+' || e.key === '=') stepCamera(1);
      else if (e.key === '-' || e.key === '_') stepCamera(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepCamera, fixedCamera]);

  // A pinch is free while it lasts and is drawn to the nearest stop when the
  // fingers leave the glass.
  const snapTimer = useRef<number | null>(null);
  const queueSnap = useCallback(() => {
    if (snapTimer.current !== null) window.clearTimeout(snapTimer.current);
    snapTimer.current = window.setTimeout(() => {
      snapTimer.current = null;
      const { view, stops: list } = cameraRef.current;
      const from = view.zoom ?? 0;
      const zoom = nearestStop(list, from);
      if (Math.abs(zoom - from) < SNAP_EPSILON) return;
      setViewState((v) => ({
        ...v,
        zoom,
        ...flight(reducedMotion, 420, 1.6),
      }));
    }, 220);
  }, [reducedMotion]);
  useEffect(() => () => {
    if (snapTimer.current !== null) window.clearTimeout(snapTimer.current);
  }, []);

  // Tell the interface where the camera sits and whether the detail for this
  // stop is still on its way: a guided camera that gives no sign of either
  // leaves the reader guessing, and stepping in again while tiles are still
  // decoding means missing the picture that was about to arrive.
  const setZoomLadder = useAtlasStore((s) => s.setZoomLadder);
  const stopIndex = useMemo(() => {
    const at = nearestStop(stops, viewState.zoom ?? 0);
    return Math.max(0, stops.indexOf(at));
  }, [stops, viewState.zoom]);
  const detailCoverage = fineUsable ? Math.min(1, Math.max(0, coverage)) : null;
  const publishedLadder = useRef('');
  useEffect(() => {
    // coarse enough not to publish on every tile, fine enough to animate
    const rounded = detailCoverage === null ? null : Math.round(detailCoverage * 20) / 20;
    const key = `${stops.join(',')}|${stopIndex}|${rounded}`;
    if (publishedLadder.current === key) return;
    publishedLadder.current = key;
    setZoomLadder(stops, stopIndex, rounded);
  }, [stops, stopIndex, detailCoverage, setZoomLadder]);

  // the reader clicked a rung
  const zoomStopRequest = useAtlasStore((s) => s.zoomStopRequest);
  const requestZoomStop = useAtlasStore((s) => s.requestZoomStop);
  useEffect(() => {
    if (zoomStopRequest === null) return;
    const zoom = stops[zoomStopRequest];
    requestZoomStop(null);
    if (zoom === undefined) return;
    setViewState((v) => ({
      ...v,
      zoom,
      ...flight(reducedMotion, STEP_MS, 1.4),
    }));
  }, [zoomStopRequest, stops, requestZoomStop, reducedMotion]);

  // Reset: the whole country, centred, at the opening angle. A zoom stop
  // only changes the zoom, so resetting from a city used to pull back while
  // staying over that city — which is not what "reset the view" means.
  const viewResetRequest = useAtlasStore((s) => s.viewResetRequest);
  const firstReset = useRef(true);
  // Everything the reset reads goes through a ref, so only the request can
  // trigger it. Listing `scene.lod.bounds` as a dependency made every dataset
  // switch perform a silent reset — the camera flew home and the pitch went
  // back to the desktop angle, which on a phone undid the flatter framing and
  // on a wide screen merely looked like it was meant.
  const resetInputs = useRef({ bounds: scene.lod.bounds, reducedMotion });
  resetInputs.current = { bounds: scene.lod.bounds, reducedMotion };
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    const { bounds, reducedMotion: reduced } = resetInputs.current;
    const fit = fitViewState(bounds, window.innerWidth, window.innerHeight, chromeInsets());
    setViewState((v) => ({
      ...v,
      ...fit,
      bearing: INITIAL_VIEW_STATE.bearing,
      ...flight(reduced, STEP_MS, 1.4),
    }));
  }, [viewResetRequest]);

  // New object identity → deck re-uploads the attributes. That now happens
  // only when an endpoint buffer actually changed (a new mode, a scrub),
  // not on every frame of a transition.
  const data = useMemo(
    () => ({
      length: scene.count,
      attributes: {
        getPosition: { value: scene.positions, size: 2 },
        getElevation: { value: engine.heights, size: 1 },
        getFillColor: { value: engine.colors, size: 4 },
        getElevationTo: { value: engine.heightsTo, size: 1 },
        getFillColorTo: { value: engine.colorsTo, size: 4 },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, engine, engine.bufferVersion, sculptureVersion],
  );

  // TextLayer bakes one glyph atlas per face and keeps it, so a label drawn
  // before its face has loaded wears the fallback for the rest of the visit.
  // The weight is the part that bites: the interface loads Inter 400 at once
  // while the labels ask for 600, which is a file of its own. Labels wait for
  // the face (`labelFaceReady`); if it is very late they go out in the
  // fallback and the atlas is re-baked when it lands.
  const [fontReady, setFontReady] = useState(false);
  const [labelFontEpoch, setLabelFontEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    void labelFaceReady().then((arrived) => {
      if (!live) return;
      setFontReady(true);
      if (arrived || !document.fonts) return;
      void document.fonts.ready.then(() => live && setLabelFontEpoch((e) => e + 1));
    });
    return () => {
      live = false;
    };
  }, []);

  const visibleLabels = useMemo(() => {
    if (!fontReady) return [];
    const zoom = viewState.zoom;
    const byZoom = zoom > 7 ? 3 : zoom > 6.2 ? 2 : 1;
    const maxTier = Math.min(byZoom, labelTierCap(quality, settings.labels));
    return scene.cities.filter((c) => c.tier <= maxTier);
  }, [fontReady, scene.cities, viewState.zoom, quality, settings.labels]);

  const characterSet = useMemo(() => labelCharacterSet(scene.cities), [scene.cities]);

  // opening sequence: labels come in last, after the sculpture has risen
  const introPhase = useAtlasStore((s) => s.introPhase);
  const labelsHeld = introPhase === 'title' || introPhase === 'reveal';
  const [labelOpacity, setLabelOpacity] = useState(labelsHeld ? 0 : 1);
  const labelsWereHeld = useRef(labelsHeld);
  useEffect(() => {
    if (labelsHeld) {
      labelsWereHeld.current = true;
      setLabelOpacity(0);
      return;
    }
    if (!labelsWereHeld.current) return; // ordinary visit: labels were never hidden
    labelsWereHeld.current = false;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 700);
      setLabelOpacity(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [labelsHeld]);

  const fineLayers = useMemo(() => {
    // The poster frames the whole country; the fine tiles cover the near
    // field of wherever the camera was standing, and pasted into that frame
    // they are a speck of unrelated detail over one city.
    if (exporting) return [];
    if (fineOpacity <= 0 || !fineLod || !tileManager) return [];
    const merged = tileManager.merged();
    if (!merged) return [];
    const fineRadius = fineLod.cellRadiusMeters * 1.15;
    // How much taller the density rule draws this level than the country
    // one: a 66 m cell covers a forty-ninth of a 460 m cell, so it carries
    // forty-nine times the metres per person. For a mean, a share or a rate
    // there is no such step and the ratio is 1.
    const fineAreaRatio = perAreaHeight.current
      ? Math.pow((scene.lod.cellRadiusMeters || 1) / (fineLod.cellRadiusMeters || 1), 2)
      : 1;
    // One layer for every visible tile, not one per tile: same geometry,
    // a single draw call and a single picking pass.
    return [
      new ColumnLayer({
        id: 'tiles-merged',
        data: {
          length: merged.count,
          attributes: {
            getPosition: { value: merged.positions, size: 2 },
            getElevation: { value: merged.heights, size: 1 },
            getFillColor: { value: merged.colors, size: 4 },
          },
        } as never,
        diskResolution: 6,
        radius: fineRadius,
        // Detail unfolds instead of replacing what was there: at mix 0 these
        // cells stand at the scale the level below was drawing, at mix 1 at
        // their own density. Landing exactly on 1 leaves the settled picture
        // untouched — this only shapes the half second of the handover, and
        // it scales the whole layer alike, so nothing is said about one cell
        // against another that was not already true.
        elevationScale: heightScale * Math.pow(fineAreaRatio, fineMix - 1),
        extruded: true,
        flatShading: true,
        // picked ahead of the country layer: the tooltip then reads this
        // cell's own values (the country cell beneath only names the place)
        pickable: true,
        onHover: (info: PickingInfo) => {
          const found = info.index >= 0 ? TileManager.locate(merged, info.index) : null;
          if (!found) {
            setHover(null);
            return;
          }
          const fine: Record<string, number> = {};
          for (const [id, arr] of Object.entries(found.tile.values)) fine[id] = arr[found.local]!;
          const lon = merged.positions[info.index * 2]!;
          const lat = merged.positions[info.index * 2 + 1]!;
          setHover({ x: info.x, y: info.y, index: nearestCountryCell(lon, lat), fine, lonLat: [lon, lat] });
        },
        opacity: fineOpacity,
        material: {
          ambient: 0.64,
          diffuse: 0.52,
          shininess: 110,
          specularColor: [46, 42, 38],
        },
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    exporting,
    tileManager,
    fineLod,
    fineOpacity,
    fineMix,
    tilesVersion,
    heightScale,
    nearestCountryCell,
    scene.lod.cellRadiusMeters,
  ]);

  // The sinking sculpture's endpoints are set once by fadeOut; only its mix
  // moves, so its data descriptor is built once per outgoing scene.
  const outgoingData = useMemo(
    () =>
      outgoing && {
        length: outgoing.scene.count,
        attributes: {
          getPosition: { value: outgoing.scene.positions, size: 2 },
          getElevation: { value: outgoing.engine.heights, size: 1 },
          getFillColor: { value: outgoing.engine.colors, size: 4 },
          getElevationTo: { value: outgoing.engine.heightsTo, size: 1 },
          getFillColorTo: { value: outgoing.engine.colorsTo, size: 4 },
        },
      },
    [outgoing],
  );
  const outgoingLayer = outgoingData
    ? createColumnLayer({
        id: 'sculpture-outgoing',
        data: outgoingData,
        mixAmount: outgoingMix,
        radius: outgoing!.radius,
        elevationScale: heightScale,
        pickable: false,
      })
    : undefined;

  const layers = createSculptureLayers({
    scene,
    data,
    radius,
    labels: visibleLabels,
    labelFontEpoch,
    characterSet,
    // poster labels: the frame is 1920 CSS px, roughly a laptop window, so
    // the on-screen size is about right already
    labelScale: exporting ? 1.15 : 1,
    labelOpacity,
    mixAmount,
    fadeBox,
    elevationScale: heightScale,
    outgoingLayer,
    fineLayers,
    border:
      settings.border && borderRings
        ? { color: hexToRgb(settings.borderColor), rings: borderRings }
        : null,
    // stays pickable: the country layer still draws the far field, and the
    // tiles carry no metric values, so hover reads the country cell
    pickable: !exporting,
    onHover: (info: PickingInfo) =>
      setHover(info.index >= 0 ? { x: info.x, y: info.y, index: info.index } : null),
  });

  // One LightingEffect for the life of the page. Swapping instances leaves
  // deck 9.1's pipeline cache holding stale shadow bindings ("texture
  // value" errors, blank frame), so strength and angle are tuned on the
  // existing effect in place (`tuneLighting`) and the viewer's on/off is
  // only the shadow ink — which is instant and needs no reload.
  //
  // The pass itself is created whenever the device could want it, not only
  // when shadows currently show. Texture-using layers (labels) opt out via
  // `shadowEnabled: false`. `?shadows=0` forces it off entirely — software
  // renderers cannot complete the pass at all.
  const shadowsWanted = shadowsEnabled(quality, settings.shadows);
  const canShadow = useRef(shadowPassPossible(quality, settings.shadows));
  const effects = useMemo(
    () => [createLighting(canShadow.current, settings.shadowStrength, settings.lightElevation)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    tuneLighting(
      effects[0]!,
      shadowsWanted && canShadow.current ? settings.shadowStrength : 0,
      settings.lightElevation,
    );
  }, [effects, shadowsWanted, settings.shadowStrength, settings.lightElevation]);
  // a phone that started without the pass and is asked for shadows anyway
  useEffect(() => {
    if (shadowsWanted && !canShadow.current) window.location.reload();
  }, [shadowsWanted]);

  const finishCapture = () => {
    if (!exporting) return;
    const canvas = deckRef.current?.deck?.canvas;
    const format = currentFormat();
    const pw = Math.round(format.width * currentDpr());
    const ph = Math.round(format.height * currentDpr());
    if (!canvas || canvas.width !== pw || canvas.height !== ph) {
      return; // resize has not landed yet; a later frame will match
    }
    // must copy synchronously — the drawing buffer is cleared after the task
    const copy = document.createElement('canvas');
    copy.width = pw;
    copy.height = ph;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);
    setExporting(false);
    if (captureIsPending()) deliverCapture(copy);
  };

  // A portrait phone gets one composed view and keeps it: no pinch, no drag,
  // no two-finger rotate. The gestures were never good here — a rotated,
  // half-panned country in a narrow frame is a worse picture than the one
  // the fit produces, and there was no way back to it except the reset. The
  // camera still moves when the app asks it to (a focus, a mode's own
  // framing); what goes is the reader's ability to knock it askew by hand.
  const view = useMemo(
    () =>
      new MapView({
        id: 'main',
        fovy: CAMERA_FOVY,
        farZMultiplier: 3,
        controller: fixedCamera
          ? false
          : {
              inertia: 260,
              touchRotate: true,
              // arrows still pan and rotate; + and − are ours (see stepCamera),
              // and deck's own zoom would slide the camera to rest anywhere
              keyboard: { zoomSpeed: 0 },
              scrollZoom: false,
              doubleClickZoom: false,
            },
      }),
    [fixedCamera],
  );

  return (
    <div
      ref={canvasRef}
      onDoubleClick={(e) => !fixedCamera && stepCamera(1, [e.clientX, e.clientY])}
      className="atlas__canvas"
      style={
        exporting
          ? {
              width: currentFormat().width,
              height: currentFormat().height,
              inset: 'auto',
            }
          : undefined
      }
    >
      <DeckGL
        ref={deckRef as never}
        views={view}
        viewState={renderView}
        onViewStateChange={({ viewState: next, interactionState }) => {
          if (exporting) return; // the 4K resize echoes the capture viewState
          setViewState(next as MapViewState);
          if (interactionState?.isZooming && !interactionState.inTransition) {
            queueSnap();
          }
        }}
        layers={layers}
        effects={effects}
        onAfterRender={finishCapture}
        // MSAA: thin needles alias badly without it
        deviceProps={{ webgl: { antialias: true } }}
        useDevicePixels={
          exporting
            ? currentDpr()
            : Math.min(window.devicePixelRatio || 1, quality.maxDevicePixelRatio)
        }
        style={{ background: 'transparent' }}
      />
    </div>
  );
}
