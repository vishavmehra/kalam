export interface DecodedPng {
  width: number;
  height: number;
  /** PNG colour type: 2 = RGB, 6 = RGBA. */
  colorType: number;
  hasAlpha: boolean;
  /** 4 bytes per pixel; opaque images carry alpha 255. */
  rgba: Uint8Array;
  /** Chunk names in file order. */
  chunks: string[];
}

export function encodePng(image: { width: number; height: number; rgba: Uint8Array; alpha: boolean }): Buffer;
export function decodePng(data: Uint8Array): DecodedPng;
