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
  WebMercatorViewport,
  type MapViewState,
  type PickingInfo,
} from '@deck.gl/core';
import { ColumnLayer } from '@deck.gl/layers';
import { type MorphEngine } from '@datenriff/sculpture-core';
import type { LonLatBounds } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { getMode } from '../modes/modes';
import { useAtlasStore } from '../state/store';
import { readUrlState, writeUrlState } from '../state/url';
import { CAMERA_FOVY, INITIAL_VIEW_STATE, fitViewState } from './camera';
import {
  CAPTURE_EVENT,
  EXPORT_DPR,
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  captureIsPending,
  deliverCapture,
} from './exportBridge';
import { createLighting } from './lighting';
import { detectQuality, shadowsEnabled } from './quality';
import { createSculptureLayers, labelCharacterSet, sculptureRadius } from './layers';
import { TileManager } from './tiles';

/** Crossfade window above a fine LOD's minZoom. */
const CROSSFADE_ZOOM_SPAN = 0.5;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Props {
  scene: SceneData;
  engine: MorphEngine;
}

export function SculptureView({ scene, engine }: Props) {
  const setHover = useAtlasStore((s) => s.setHover);
  const setView = useAtlasStore((s) => s.setView);
  const modeId = useAtlasStore((s) => s.modeId);
  const timeT = useAtlasStore((s) => s.timeT);
  const palette = useAtlasStore((s) => s.palette);
  const sculptureVersion = useAtlasStore((s) => s.sculptureVersion);

  const quality = useMemo(() => detectQuality(), []);

  const [viewState, setViewState] = useState<MapViewState>(() => {
    const shared = readUrlState().view;
    // a shared URL wins; otherwise fit the country to this window
    if (shared) return { ...INITIAL_VIEW_STATE, ...shared };
    return fitViewState(scene.lod.bounds, window.innerWidth, window.innerHeight);
  });
  const [frameVersion, setFrameVersion] = useState(0);
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

  // advance the morph engine; re-upload only when buffers changed
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      if (engine.tick(now)) setFrameVersion((v) => v + 1);
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

  const mode = getMode(modeId);

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

  const fineLod = tileManager?.activeLod(viewState.zoom) ?? null;
  const fineUsable =
    tileManager !== null &&
    fineLod !== null &&
    timeT >= 1 &&
    tileManager.supportsMode(fineLod, mode);
  const fineOpacity = fineUsable
    ? clamp01((viewState.zoom - fineLod.minZoom) / CROSSFADE_ZOOM_SPAN)
    : 0;

  useEffect(() => {
    if (!fineUsable || !tileManager || !quality.streamTiles) return;
    const timer = setTimeout(() => {
      const vp = new WebMercatorViewport({
        ...viewState,
        width: window.innerWidth,
        height: window.innerHeight,
      });
      const [w, s] = vp.unproject([0, window.innerHeight]);
      const [e, n] = vp.unproject([window.innerWidth, 0]);
      tileManager.update({
        bounds: [w!, s!, e!, n!] as LonLatBounds,
        zoom: viewState.zoom,
        mode,
        palette,
        enabled: true,
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [tileManager, fineUsable, viewState, mode, palette, quality.streamTiles]);

  useEffect(() => {
    writeUrlState(modeId, timeT, palette, viewState);
    setView(viewState);
  }, [modeId, timeT, palette, viewState, setView]);

  const radius = sculptureRadius(scene);

  // new object identity → deck re-uploads the mutated binary attributes
  const data = useMemo(
    () => ({
      length: scene.count,
      attributes: {
        getPosition: { value: scene.positions, size: 2 },
        getElevation: { value: engine.heights, size: 1 },
        getFillColor: { value: engine.colors, size: 4 },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, engine, frameVersion, sculptureVersion],
  );

  const visibleLabels = useMemo(() => {
    const zoom = viewState.zoom;
    const byZoom = zoom > 7 ? 3 : zoom > 6.2 ? 2 : 1;
    const maxTier = Math.min(byZoom, quality.maxLabelTier);
    return scene.cities.filter((c) => c.tier <= maxTier);
  }, [scene.cities, viewState.zoom, quality.maxLabelTier]);

  const characterSet = useMemo(() => labelCharacterSet(scene.cities), [scene.cities]);

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
  }, [tileManager, fineLod, fineOpacity, tilesVersion]);

  const layers = createSculptureLayers({
    scene,
    data,
    radius,
    labels: visibleLabels,
    characterSet,
    // poster labels: the frame is 1920 CSS px, roughly a laptop window, so
    // the on-screen size is about right already
    labelScale: exporting ? 1.15 : 1,
    sculptureOpacity: 1 - fineOpacity,
    fineLayers,
    // stays pickable while the fine tiles fade in: tiles carry no metric
    // values, so hover keeps reading the country cell underneath
    pickable: !exporting && fineOpacity < 0.98,
    onHover: (info: PickingInfo) =>
      setHover(info.index >= 0 ? { x: info.x, y: info.y, index: info.index } : null),
  });

  // Shadows stay on permanently: swapping LightingEffect instances leaves
  // deck 9.1's pipeline cache holding stale shadow bindings. Texture-using
  // layers (labels, outline) opt out via `shadowEnabled: false`.
  // `?shadows=0` turns them off — software renderers (headless CI, machines
  // without a GPU) cannot complete the shadow pass at all.
  const effects = useMemo(() => [createLighting(shadowsEnabled(quality))], [quality]);

  const finishCapture = () => {
    if (!exporting) return;
    const canvas = deckRef.current?.deck?.canvas;
    const pw = EXPORT_WIDTH * EXPORT_DPR;
    const ph = EXPORT_HEIGHT * EXPORT_DPR;
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
          ? { width: EXPORT_WIDTH, height: EXPORT_HEIGHT, inset: 'auto' }
          : undefined
      }
    >
      <DeckGL
        ref={deckRef as never}
        views={view}
        viewState={
          exporting
            ? (exportView.current ??= {
                ...fitViewState(scene.lod.bounds, EXPORT_WIDTH, EXPORT_HEIGHT),
                pitch: viewState.pitch,
                bearing: viewState.bearing,
              })
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
            ? EXPORT_DPR
            : Math.min(window.devicePixelRatio || 1, quality.maxDevicePixelRatio)
        }
        style={{ background: 'transparent' }}
      />
    </div>
  );
}
