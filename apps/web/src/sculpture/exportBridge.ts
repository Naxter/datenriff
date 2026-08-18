// Bridge between the export button and the live deck instance. A second
// Deck in the same page trips over luma's device-bound caches, so the
// poster is captured from the app's own canvas, resized to 4K for one
// frame by SculptureView.

// Social formats (plan §101). CSS size of the capture frame; the deck
// renders it at 2× device pixels and the poster composes at that
// resolution, so needles stay crisp.
export const EXPORT_DPR = 2;

export interface ExportFormat {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const EXPORT_FORMATS: ExportFormat[] = [
  { id: '16x9', label: '16:9', width: 1920, height: 1080 },
  { id: '4x5', label: '4:5', width: 1080, height: 1350 },
  { id: '1x1', label: '1:1', width: 1440, height: 1440 },
  { id: '9x16', label: '9:16', width: 1080, height: 1920 },
];

export const DEFAULT_FORMAT = EXPORT_FORMATS[0]!;

let activeFormat: ExportFormat = DEFAULT_FORMAT;
let activeDpr = EXPORT_DPR;

export function currentFormat(): ExportFormat {
  return activeFormat;
}

/** Device pixels per CSS pixel of the capture in progress: 2 for the
 *  poster, a fraction for the dialog's preview. */
export function currentDpr(): number {
  return activeDpr;
}

export const CAPTURE_EVENT = 'atlas-capture';

interface PendingCapture {
  resolve: (canvas: HTMLCanvasElement) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let pending: PendingCapture | null = null;

/** Ask the live view for a poster frame; resolves with a copied canvas.
 *  `dpr` < EXPORT_DPR gives a quick low-resolution frame for previews. */
export function requestSculptureCapture(
  format: ExportFormat = DEFAULT_FORMAT,
  dpr = EXPORT_DPR,
  timeoutMs = 60_000,
): Promise<HTMLCanvasElement> {
  if (pending) return Promise.reject(new Error('Capture already in progress'));
  activeFormat = format;
  activeDpr = dpr;
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    pending = {
      resolve,
      reject,
      timer: setTimeout(() => {
        pending = null;
        reject(new Error('Capture timed out'));
      }, timeoutMs),
    };
    window.dispatchEvent(new Event(CAPTURE_EVENT));
  });
}

export function captureIsPending(): boolean {
  return pending !== null;
}

export function deliverCapture(canvas: HTMLCanvasElement): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  const p = pending;
  pending = null;
  p.resolve(canvas);
}

export function failCapture(error: Error): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  const p = pending;
  pending = null;
  p.reject(error);
}
