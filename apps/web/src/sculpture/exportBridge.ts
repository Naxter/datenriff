// Bridge between the export button and the live deck instance. A second
// Deck in the same page trips over luma's device-bound caches, so the
// poster is captured from the app's own canvas, resized to 4K for one
// frame by SculptureView.

export const EXPORT_WIDTH = 3840;
export const EXPORT_HEIGHT = 2160;

export const CAPTURE_EVENT = 'atlas-capture';

interface PendingCapture {
  resolve: (canvas: HTMLCanvasElement) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let pending: PendingCapture | null = null;

/** Ask the live view for a 4K frame; resolves with a copied canvas. */
export function requestSculptureCapture(timeoutMs = 60_000): Promise<HTMLCanvasElement> {
  if (pending) return Promise.reject(new Error('Capture already in progress'));
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
