import { create } from 'zustand';
import type { MapViewState } from '@deck.gl/core';
import type { AtlasManifest, CameraStop } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';

export interface HoverInfo {
  x: number;
  y: number;
  index: number;
}

interface AtlasState {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  manifest?: AtlasManifest;
  scene?: SceneData;
  /** A further dataset is streaming in while `scene` stays on screen. */
  sceneLoading: boolean;
  modeId: string;
  /** Timeline position for time-enabled modes; 1 = latest step. */
  timeT: number;
  /** Optional ramp override for sequential modes; null = mode default. */
  palette: string | null;
  hover: HoverInfo | null;
  /** Latest camera state; read imperatively (e.g. by the poster export). */
  view: MapViewState | null;
  /** Current stop of a running camera story, or null. */
  storyStop: CameraStop | null;
  /** Bumped when the engine buffers were mutated outside the render loop. */
  sculptureVersion: number;
  setManifest(manifest: AtlasManifest): void;
  setScene(scene: SceneData): void;
  setError(message: string): void;
  setMode(id: string): void;
  setTimeT(t: number): void;
  setPalette(palette: string | null): void;
  setHover(hover: HoverInfo | null): void;
  setView(view: MapViewState): void;
  playStory(stop: CameraStop | null): void;
  bumpSculpture(): void;
}

export const useAtlasStore = create<AtlasState>((set) => ({
  status: 'loading',
  sceneLoading: false,
  modeId: 'people',
  timeT: 1,
  palette: null,
  hover: null,
  view: null,
  storyStop: null,
  sculptureVersion: 0,
  setManifest: (manifest) => set({ manifest }),
  setScene: (scene) => set({ scene, status: 'ready', sceneLoading: false }),
  setError: (error) => set({ error, status: 'error' }),
  setMode: (modeId) => set({ modeId, timeT: 1, hover: null }),
  setTimeT: (timeT) => set({ timeT }),
  setPalette: (palette) => set({ palette }),
  setHover: (hover) => set({ hover }),
  setView: (view) => set({ view }),
  playStory: (storyStop) => set({ storyStop }),
  bumpSculpture: () => set((s) => ({ sculptureVersion: s.sculptureVersion + 1 })),
}));
