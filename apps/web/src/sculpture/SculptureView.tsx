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
import { CAMERA_FOVY, INITIAL_VIEW_STATE } from './camera';
import {
  CAPTURE_EVENT,
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  captureIsPending,
  deliverCapture,
} from './exportBridge';
import { createLighting } from './lighting';
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

  const [viewState, setViewState] = useState<MapViewState>(() => ({
    ...INITIAL_VIEW_STATE,
    ...readUrlState().view,
  }));
  const [frameVersion, setFrameVersion] = useState(0);
  const [exporting, setExporting] = useState(false);
  const deckRef = useRef<{ deck?: { canvas?: HTMLCanvasElement | null } } | null>(null);
  // mercator zoom is absolute scale — compensate so the sculpture keeps its
  // on-screen proportion in the larger poster frame
  const exportZoomDelta = useRef(0);

  // poster capture: resize the deck to 4K for one frame, copy, restore
  useEffect(() => {
    const onCapture = () => {
      exportZoomDelta.current = Math.log2(EXPORT_HEIGHT / window.innerHeight);
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
    if (!fineUsable || !tileManager) return;
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
  }, [tileManager, fineUsable, viewState, mode, palette]);

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
    const maxTier = zoom > 7 ? 3 : zoom > 6.2 ? 2 : 1;
    return scene.cities.filter((c) => c.tier <= maxTier);
  }, [scene.cities, viewState.zoom]);

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
    // 4K frame: labels keep their poster proportion
    labelScale: exporting ? 2.2 : 1,
    sculptureOpacity: 1 - fineOpacity,
    fineLayers,
    pickable: !exporting && fineOpacity === 0,
    onHover: (info: PickingInfo) =>
      setHover(info.index >= 0 ? { x: info.x, y: info.y, index: info.index } : null),
  });

  // Ambient + key + fill only. deck 9.1's shadow pass corrupts texture
  // bindings once several texture-using layers coexist (the label font
  // atlas ends up in the shadow sampler slot); real soft shadows are the
  // prototype's shadow-mapping approach, still to be ported.
  const effects = useMemo(() => [createLighting(false)], []);

  const finishCapture = () => {
    if (!exporting) return;
    const canvas = deckRef.current?.deck?.canvas;
    if (!canvas || canvas.width !== EXPORT_WIDTH || canvas.height !== EXPORT_HEIGHT) {
      return; // resize has not landed yet; a later frame will match
    }
    // must copy synchronously — the drawing buffer is cleared after the task
    const copy = document.createElement('canvas');
    copy.width = EXPORT_WIDTH;
    copy.height = EXPORT_HEIGHT;
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
            ? { ...viewState, zoom: viewState.zoom + exportZoomDelta.current }
            : viewState
        }
        onViewStateChange={({ viewState: next }) => {
          if (exporting) return; // the 4K resize echoes the capture viewState
          setViewState(next as MapViewState);
        }}
        layers={layers}
        effects={effects}
        onAfterRender={finishCapture}
        useDevicePixels={exporting ? 1 : Math.min(window.devicePixelRatio || 1, 2)}
        style={{ background: 'transparent' }}
      />
    </div>
  );
}
