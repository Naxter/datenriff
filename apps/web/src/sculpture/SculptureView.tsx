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
import { ColumnLayer, PathLayer, TextLayer } from '@deck.gl/layers';
import { hexColumnRadius, type MorphEngine } from '@datenriff/sculpture-core';
import type { CityLabel } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { useAtlasStore } from '../state/store';
import { readUrlState, writeUrlState } from '../state/url';
import { CAMERA_FOVY, INITIAL_VIEW_STATE } from './camera';
import { createLighting } from './lighting';
import { PLINTH_COLOR, PLINTH_DEPTH_METERS } from './targets';

// The canvas stays transparent; the paper tone comes from the page background
// (--paper in design/global.css), so there is no clear colour to set here.
const INK: [number, number, number, number] = [34, 28, 21, 235];

/** Delay before shadows return once the camera rests. */
const SHADOW_IDLE_DELAY_MS = 220;

interface Props {
  scene: SceneData;
  engine: MorphEngine;
}

export function SculptureView({ scene, engine }: Props) {
  const setHover = useAtlasStore((s) => s.setHover);
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
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();

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
  }, [modeId, timeT, palette, viewState]);

  // slight overlap closes gaps between hex disks
  const radius = scene.lod.cellRadiusMeters
    ? scene.lod.cellRadiusMeters * 1.15
    : hexColumnRadius(scene.lod.resolution);

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

  // positions only; elevation and colour are constant for the plinth
  const plinthData = useMemo(
    () => ({
      length: scene.count,
      attributes: { getPosition: { value: scene.positions, size: 2 } },
    }),
    [scene],
  );

  const visibleLabels = useMemo(() => {
    const zoom = viewState.zoom;
    const maxTier = zoom > 7 ? 3 : zoom > 6.2 ? 2 : 1;
    return scene.cities.filter((c) => c.tier <= maxTier);
  }, [scene.cities, viewState.zoom]);

  const characterSet = useMemo(() => {
    const chars = new Set<string>();
    for (const c of scene.cities) for (const ch of c.name.toUpperCase()) chars.add(ch);
    return [...chars];
  }, [scene.cities]);

  const layers = [
    scene.boundary.length > 0 &&
      new PathLayer({
        id: 'outline',
        data: scene.boundary,
        getPath: (ring: [number, number][]) => [...ring, ring[0]!],
        getColor: [34, 28, 21, 26],
        getWidth: 1.2,
        widthUnits: 'pixels',
        jointRounded: true,
      }),
    // plinth: the same cells extruded downwards, so the country reads as a
    // slab floating on the paper rather than a field of loose columns
    new ColumnLayer({
      id: 'plinth',
      data: plinthData as unknown as never,
      diskResolution: 6,
      radius,
      extruded: true,
      flatShading: true,
      pickable: false,
      // deck.gl skips columns with a negative elevation, so flip the scale
      getElevation: PLINTH_DEPTH_METERS,
      elevationScale: -1,
      getFillColor: [...PLINTH_COLOR, 255],
      material: {
        ambient: 0.7,
        diffuse: 0.42,
        shininess: 40,
        specularColor: [30, 27, 24],
      },
    }),
    new ColumnLayer({
      id: 'sculpture',
      // binary attribute objects are supported but typed loosely
      data: data as unknown as never,
      diskResolution: 6,
      radius,
      extruded: true,
      flatShading: true,
      pickable: true,
      material: {
        ambient: 0.64,
        diffuse: 0.52,
        shininess: 110,
        specularColor: [46, 42, 38],
      },
      onHover: (info: PickingInfo) =>
        setHover(info.index >= 0 ? { x: info.x, y: info.y, index: info.index } : null),
    }),
    new TextLayer<CityLabel>({
      id: 'labels',
      data: visibleLabels,
      characterSet,
      billboard: true,
      sizeUnits: 'pixels',
      getPosition: (d) => [d.lon, d.lat],
      getText: (d) => d.name.toUpperCase(),
      getSize: (d) => (d.tier === 1 ? 12.5 : 11),
      getColor: INK,
      getPixelOffset: [0, -14],
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: 600,
      fontSettings: { sdf: true, fontSize: 128, buffer: 8, radius: 12 },
      outlineWidth: 6,
      outlineColor: [247, 240, 234, 235],
      // labels sit on the paper plane; draw them over the columns like a poster overlay
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
    }),
  ].filter(Boolean);

  const effects = useMemo(() => [createLighting(idle)], [idle]);

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
    <div className="atlas__canvas">
      <DeckGL
        views={view}
        viewState={viewState}
        onViewStateChange={({ viewState: next }) => {
          setViewState(next as MapViewState);
          setIdle(false);
          clearTimeout(idleTimer.current);
          idleTimer.current = setTimeout(() => setIdle(true), SHADOW_IDLE_DELAY_MS);
        }}
        layers={layers}
        effects={effects}
        useDevicePixels={Math.min(window.devicePixelRatio || 1, 2)}
        style={{ background: 'transparent' }}
      />
    </div>
  );
}
