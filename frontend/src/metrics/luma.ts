/** Frame size used for brightness and motion (the spec allows downscaling for speed). */
export const ANALYSIS_WIDTH = 160;
export const ANALYSIS_HEIGHT = 120;
export const ANALYSIS_PIXELS = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;

/**
 * Converts RGBA pixels to luma (0.299R + 0.587G + 0.114B), writing one byte per pixel into
 * `out`, and returns the exact mean luma (the frame's brightness, 0..255).
 *
 * The mean is taken from the unrounded values; `out` holds rounded luma for the motion diff.
 * Allocation-free: the caller owns and reuses `out`.
 */
export function computeLuma(rgba: Uint8ClampedArray, out: Uint8Array): number {
  const pixels = out.length;
  if (rgba.length !== pixels * 4) {
    throw new RangeError(`expected ${String(pixels * 4)} RGBA bytes, got ${String(rgba.length)}`);
  }
  let sum = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    const luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    sum += luma;
    out[p] = luma + 0.5; // Uint8Array assignment truncates, so +0.5 rounds
  }
  return sum / pixels;
}

/** Mean absolute luma difference between two frames (0..255). */
export function meanMotion(current: Uint8Array, previous: Uint8Array): number {
  if (current.length !== previous.length) {
    throw new RangeError("frames must have the same size");
  }
  let sum = 0;
  for (let p = 0; p < current.length; p++) {
    const diff = current[p] - previous[p];
    sum += diff < 0 ? -diff : diff;
  }
  return sum / current.length;
}
