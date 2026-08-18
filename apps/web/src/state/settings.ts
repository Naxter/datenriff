// Viewer settings: persisted in localStorage, overridable per URL for
// testing (`?quality=`, `?shadows=0`), resolved against device detection.

export type Tri = 'auto' | 'on' | 'off';

export interface Settings {
  shadows: Tri;
  /** Shadow ink alpha on the paper plane. */
  shadowStrength: number;
  /** Key light elevation above the plane, degrees. */
  lightElevation: number;
  quality: 'auto' | 'desktop' | 'mobile';
  labels: 'auto' | 'major' | 'all' | 'none';
  motion: 'auto' | 'full' | 'reduced';
}

export const DEFAULT_SETTINGS: Settings = {
  shadows: 'auto',
  shadowStrength: 0.22,
  lightElevation: 62,
  quality: 'auto',
  labels: 'auto',
  motion: 'auto',
};

export const SHADOW_STRENGTH_RANGE: [number, number] = [0, 0.5];
export const LIGHT_ELEVATION_RANGE: [number, number] = [30, 80];

const KEY = 'datenriff:settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return sanitize({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable — settings live for the session only
  }
}

function sanitize(s: Settings): Settings {
  const clamp = (v: unknown, [lo, hi]: [number, number], d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
    allowed.includes(v as T) ? (v as T) : d;
  return {
    shadows: oneOf(s.shadows, ['auto', 'on', 'off'], 'auto'),
    shadowStrength: clamp(s.shadowStrength, SHADOW_STRENGTH_RANGE, DEFAULT_SETTINGS.shadowStrength),
    lightElevation: clamp(s.lightElevation, LIGHT_ELEVATION_RANGE, DEFAULT_SETTINGS.lightElevation),
    quality: oneOf(s.quality, ['auto', 'desktop', 'mobile'], 'auto'),
    labels: oneOf(s.labels, ['auto', 'major', 'all', 'none'], 'auto'),
    motion: oneOf(s.motion, ['auto', 'full', 'reduced'], 'auto'),
  };
}

/** Reduced motion: explicit setting first, else the OS preference. */
export function resolveReducedMotion(s: Settings): boolean {
  if (s.motion === 'reduced') return true;
  if (s.motion === 'full') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
