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
import { MapView, type MapViewState, type PickingInfo } from '@deck.gl/core';
import { type MorphEngine } from '@datenriff/sculpture-core';
import type { SceneData } from '../data/loader';
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

/** Delay before shadows return once the camera rests. */
const SHADOW_IDLE_DELAY_MS = 220;

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
  const [idle, setIdle] = useState(true);
  const [exporting, setExporting] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
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

  const layers = createSculptureLayers({
    scene,
    data,
    radius,
    labels: visibleLabels,
    characterSet,
    // 4K frame: labels keep their poster proportion
    labelScale: exporting ? 2.2 : 1,
    pickable: !exporting,
    onHover: (info: PickingInfo) =>
      setHover(info.index >= 0 ? { x: info.x, y: info.y, index: info.index } : null),
  });

  const effects = useMemo(() => [createLighting(idle || exporting)], [idle, exporting]);

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
          setIdle(false);
          clearTimeout(idleTimer.current);
          idleTimer.current = setTimeout(() => setIdle(true), SHADOW_IDLE_DELAY_MS);
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
