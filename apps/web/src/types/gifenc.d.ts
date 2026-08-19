// gifenc ships no types. Only the three calls the animation export uses
// are declared, which is also a record of the API it depends on.
declare module 'gifenc' {
  export interface GifEncoderFrameOptions {
    palette?: number[][];
    delay?: number;
    transparent?: boolean;
    repeat?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifEncoderFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number },
  ): number[][];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array;
}
