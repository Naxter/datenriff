// One ColumnLayer with binary GPU attributes renders every cell; a faint
// country outline and a handful of city labels are the only other layers —
// no basemap. The morph engine's buffers are re-uploaded only on frames
// where they actually changed.
//
// deck.gl is pinned to 9.1.x on purpose: in 9.3.10 the picking pass writes
// nothing into its offscreen framebuffer, so hover picking never returns a
// cell. Verify picking after any deck.gl upgrade.

import { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import {
  FlyToInterpolator,
  MapView,
  type MapViewState,
  type PickingInfo,
} from '@deck.gl/core';
import { ColumnLayer } from '@deck.gl/layers';
import { type MorphEngine } from '@datenriff/sculpture-core';
import type { SceneData } from '../data/loader';
import { getMode } from '../modes/modes';
import { useAtlasStore } from '../state/store';
import { readUrlState, writeUrlState } from '../state/url';
import { CAMERA_FOVY, INITIAL_VIEW_STATE, fitViewState, zoomHeightScale } from './camera';
import {
  CAPTURE_EVENT,
  currentDpr,
  captureIsPending,
  currentFormat,
  deliverCapture,
} from './exportBridge';
import { createLighting, tuneLighting } from './lighting';
import { labelTierCap, shadowsEnabled } from './quality';
import { resolveReducedMotion } from '../state/settings';
import {
  createColumnLayer,
  createSculptureLayers,
  labelCharacterSet,
  sculptureRadius,
} from './layers';
import type { FadeBox } from './morphColumnLayer';
import { TileManager, tileZone } from './tiles';
import { focusBounds, focusKey } from './focus';

/** Crossfade window above a fine LOD's minZoom. */
const CROSSFADE_ZOOM_SPAN = 0.5;
/** Tile coverage of the zone at which the country LOD starts to yield, and
 *  at which it has fully yielded. */
const COVERAGE_START = 0.6;
const COVERAGE_FULL = 0.92;
/** Minimum spacing between tile queries while the camera moves. */
const TILE_QUERY_MS = 250;

/** How long a replaced dataset's sculpture takes to sink into the plane. */
const OUTGOING_MS = 950;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

export function SculptureView({ scene, engine }: Props) {
  const setHover = useAtlasStore((s) => s.setHover);
  const setView = useAtlasStore((s) => s.setView);
  const modeId = useAtlasStore((s) => s.modeId);
  const timeT = useAtlasStore((s) => s.timeT);
  const palette = useAtlasStore((s) => s.palette);
  const sculptureVersion = useAtlasStore((s) => s.sculptureVersion);
  const storyStop = useAtlasStore((s) => s.storyStop);

  const quality = useAtlasStore((s) => s.quality);
  const settings = useAtlasStore((s) => s.settings);

  const [viewState, setViewState] = useState<MapViewState>(() => {
    const shared = readUrlState().view;
    // a shared URL wins; otherwise fit the country to this window
    if (shared) return { ...INITIAL_VIEW_STATE, ...shared };
    return fitViewState(scene.lod.bounds, window.innerWidth, window.innerHeight);
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
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      engine.tick(now);
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
      if (!pinnedView.current && mode.camera) {
        setViewState((v) => ({ ...v, ...mode.camera }));
      }
      return;
    }
    if (lastCameraMode.current === modeId) return;
    lastCameraMode.current = modeId;
    pinnedView.current = false;
    const target = mode.camera ?? { pitch: INITIAL_VIEW_STATE.pitch, bearing: INITIAL_VIEW_STATE.bearing };
    setViewState((v) => ({
      ...v,
      ...target,
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }),
    }));
  }, [modeId, mode.camera]);

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
    const fit = fitViewState(bounds, window.innerWidth, window.innerHeight);
    setViewState((v) => ({
      ...v,
      longitude: fit.longitude,
      latitude: fit.latitude,
      // a state fills the frame; a city radius fits loosely
      zoom: focus?.kind === 'city' ? fit.zoom - 0.4 : fit.zoom,
      transitionDuration: 1400,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.3 }),
    }));
  }, [focus, scene.lod.bounds]);

  // camera stories fly the view to each stop in turn
  useEffect(() => {
    if (!storyStop) return;
    setViewState((v) => ({
      ...v,
      longitude: storyStop.longitude,
      latitude: storyStop.latitude,
      zoom: storyStop.zoom,
      pitch: storyStop.pitch ?? v.pitch,
      bearing: storyStop.bearing ?? v.bearing,
      transitionDuration: 2200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.2, curve: 1.3 }),
    }));
  }, [storyStop]);

  const fineLod = tileManager?.activeLod(viewState.zoom) ?? null;
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
  const zoomRamp = fineUsable
    ? clamp01((viewState.zoom - fineLod.minZoom) / CROSSFADE_ZOOM_SPAN)
    : 0;
  const fineOpacity = zoomRamp * clamp01((coverage - COVERAGE_START) / (COVERAGE_FULL - COVERAGE_START));
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
  // the camera is still descending (plan §73).
  const lastTileQuery = useRef(0);
  useEffect(() => {
    if (!fineUsable || !tileManager || !quality.streamTiles) return;
    const run = () => {
      lastTileQuery.current = performance.now();
      tileManager.update({ ...zoneInfo, zoom: viewState.zoom, mode, palette, region: focus, enabled: true });
    };
    const wait = Math.max(0, TILE_QUERY_MS - (performance.now() - lastTileQuery.current));
    const timer = setTimeout(run, wait);
    return () => clearTimeout(timer);
  }, [tileManager, fineUsable, zoneInfo, viewState.zoom, mode, palette, focus, quality.streamTiles]);

  useEffect(() => {
    writeUrlState(modeId, timeT, palette, viewState, focusKey(focus) || null);
    setView(viewState);
  }, [modeId, timeT, palette, viewState, focus, setView]);

  const radius = sculptureRadius(scene);

  // columns ease down in height as the camera closes in past the country
  // framing (a 100 km needle would otherwise fill a city frame)
  const countryZoom = fitViewState(scene.lod.bounds, window.innerWidth, window.innerHeight).zoom;
  const heightScale = zoomHeightScale(viewState.zoom, countryZoom);

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

  const visibleLabels = useMemo(() => {
    const zoom = viewState.zoom;
    const byZoom = zoom > 7 ? 3 : zoom > 6.2 ? 2 : 1;
    const maxTier = Math.min(byZoom, labelTierCap(quality, settings.labels));
    return scene.cities.filter((c) => c.tier <= maxTier);
  }, [scene.cities, viewState.zoom, quality, settings.labels]);

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fineLayers = useMemo(() => {
    if (fineOpacity <= 0 || !fineLod || !tileManager) return [];
    const fineRadius = fineLod.cellRadiusMeters * 1.15;
    return tileManager.tiles().map(
      (tile) =>
        new ColumnLayer({
          id: `tile-${tile.key}`,
          data: {
            length: tile.count,
            attributes: {
              getPosition: { value: tile.positions, size: 2 },
              getElevation: { value: tile.heights, size: 1 },
              getFillColor: { value: tile.colors, size: 4 },
            },
          } as never,
          diskResolution: 6,
          radius: fineRadius,
          elevationScale: heightScale,
          extruded: true,
          flatShading: true,
          pickable: false,
          opacity: fineOpacity,
          material: {
            ambient: 0.64,
            diffuse: 0.52,
            shininess: 110,
            specularColor: [46, 42, 38],
          },
        }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileManager, fineLod, fineOpacity, tilesVersion, heightScale]);

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
    // stays pickable: the country layer still draws the far field, and the
    // tiles carry no metric values, so hover reads the country cell
    pickable: !exporting,
    onHover: (info: PickingInfo) =>
      setHover(info.index >= 0 ? { x: info.x, y: info.y, index: info.index } : null),
  });

  // One LightingEffect for the life of the page. Swapping instances leaves
  // deck 9.1's pipeline cache holding stale shadow bindings ("texture
  // value" errors, blank frame), so strength and angle are tuned on the
  // existing effect in place (`tuneLighting`), and switching shadows off
  // just sets their ink to zero. Only switching them *on* after starting
  // without needs the shadow pass created — that reloads the page (the URL
  // carries the view). Texture-using layers (labels) opt out via
  // `shadowEnabled: false`. `?shadows=0` forces off — software renderers
  // cannot complete the shadow pass at all.
  const shadowsWanted = shadowsEnabled(quality, settings.shadows);
  const effectHasShadows = useRef(shadowsWanted);
  const effects = useMemo(
    () => [
      createLighting(effectHasShadows.current, settings.shadowStrength, settings.lightElevation),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    tuneLighting(
      effects[0]!,
      shadowsWanted ? settings.shadowStrength : 0,
      settings.lightElevation,
    );
  }, [effects, shadowsWanted, settings.shadowStrength, settings.lightElevation]);
  useEffect(() => {
    if (shadowsWanted && !effectHasShadows.current) window.location.reload();
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

  const view = useMemo(
    () =>
      new MapView({
        id: 'main',
        fovy: CAMERA_FOVY,
        farZMultiplier: 3,
        controller: { inertia: 260, touchRotate: true, keyboard: true },
      }),
    [],
  );

  return (
    <div
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
        viewState={
          exporting
            ? (exportView.current ??= (() => {
                const f = currentFormat();
                // Germany is wider than it is tall, so a portrait crop would
                // leave it small between two empty bands. Turning the camera
                // lays the country diagonally across the frame instead.
                const portrait = f.width / f.height < 0.9;
                const bearing = (viewState.bearing ?? 0) - (portrait ? 25 : 0);
                return {
                  ...fitViewState(scene.lod.bounds, f.width, f.height),
                  pitch: viewState.pitch,
                  bearing,
                };
              })())
            : viewState
        }
        onViewStateChange={({ viewState: next }) => {
          if (exporting) return; // the 4K resize echoes the capture viewState
          setViewState(next as MapViewState);
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
