import { create } from 'zustand';
import type { MapViewState } from '@deck.gl/core';
import type { AtlasManifest, CameraStop } from '@datenriff/data-contracts';
import type { SceneData } from '../data/loader';
import { detectQuality, type QualityProfile } from '../sculpture/quality';
import { loadSettings, saveSettings, type Settings } from './settings';
import { detectLang, persistLang } from '../i18n';
import type { Lang } from '../i18n/strings';
import type { FocusGeometry } from '../sculpture/focus';

export interface HoverInfo {
  x: number;
  y: number;
  /** Country-LOD cell under the pointer (for the place name and fallback). */
  index: number;
  /** When a fine tile cell was picked: its own metric values by id. */
  fine?: Record<string, number>;
  /** Position of the picked fine cell. */
  lonLat?: [number, number];
}

/** 'title': title alone, sculpture held flat · 'reveal': sculpture rising,
 *  tagline appears · 'done': title gone, UI in. */
export type IntroPhase = 'title' | 'reveal' | 'done';

interface AtlasState {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  manifest?: AtlasManifest;
  scene?: SceneData;
  /** A further dataset is streaming in while `scene` stays on screen. */
  sceneLoading: boolean;
  /** 0…1 while a dataset streams in; the buffers are counted as they land. */
  sceneProgress: number;
  /** Opening sequence: title on empty paper → the sculpture rises beneath
   *  it → tagline → UI. null = no intro this visit. */
  introPhase: IntroPhase | null;
  /** UI language; `?lang=` pins it, otherwise the viewer's choice or the
   *  browser's. Only the interface changes — the data keeps its own words. */
  lang: Lang;
  /** Viewer settings (persisted) and the quality profile resolved from them. */
  settings: Settings;
  quality: QualityProfile;
  settingsOpen: boolean;
  /** Region in focus (a state outline or a city radius); null = whole country. */
  focus: FocusGeometry | null;
  focusOpen: boolean;
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
  setIntroPhase(phase: IntroPhase | null): void;
  updateSettings(patch: Partial<Settings>): void;
  setLang(lang: Lang): void;
  setSettingsOpen(open: boolean): void;
  setFocus(focus: FocusGeometry | null): void;
  setFocusOpen(open: boolean): void;
  setMode(id: string): void;
  setTimeT(t: number): void;
  setPalette(palette: string | null): void;
  setHover(hover: HoverInfo | null): void;
  setView(view: MapViewState): void;
  playStory(stop: CameraStop | null): void;
  bumpSculpture(): void;
}

const initialSettings = loadSettings();

export const useAtlasStore = create<AtlasState>((set) => ({
  status: 'loading',
  sceneLoading: false,
  sceneProgress: 0,
  introPhase: null,
  lang: detectLang(),
  settings: initialSettings,
  quality: detectQuality(initialSettings.quality),
  settingsOpen: false,
  focus: null,
  focusOpen: false,
  modeId: 'people',
  timeT: 1,
  palette: null,
  hover: null,
  view: null,
  storyStop: null,
  sculptureVersion: 0,
  setManifest: (manifest) => set({ manifest }),
  setScene: (scene) => set({ scene, status: 'ready', sceneLoading: false, sceneProgress: 1 }),
  setError: (error) => set({ error, status: 'error' }),
  setIntroPhase: (introPhase) => set({ introPhase }),
  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      saveSettings(settings);
      return { settings, quality: detectQuality(settings.quality) };
    }),
  setLang: (lang) => {
    persistLang(lang);
    set({ lang });
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setFocus: (focus) => set({ focus, hover: null }),
  setFocusOpen: (focusOpen) => set({ focusOpen }),
  setMode: (modeId) => set({ modeId, timeT: 1, hover: null }),
  setTimeT: (timeT) => set({ timeT }),
  setPalette: (palette) => set({ palette }),
  setHover: (hover) => set({ hover }),
  setView: (view) => set({ view }),
  playStory: (storyStop) => set({ storyStop }),
  bumpSculpture: () => set((s) => ({ sculptureVersion: s.sculptureVersion + 1 })),
}));
