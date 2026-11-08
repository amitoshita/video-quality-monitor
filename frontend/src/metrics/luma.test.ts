import { describe, expect, it } from "vitest";
import { ANALYSIS_PIXELS, computeLuma, meanMotion } from "./luma";

function solid(r: number, g: number, b: number, pixels = ANALYSIS_PIXELS): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
  return rgba;
}

function lumaOf(rgba: Uint8ClampedArray): { mean: number; luma: Uint8Array } {
  const luma = new Uint8Array(rgba.length / 4);
  return { mean: computeLuma(rgba, luma), luma };
}

describe("computeLuma", () => {
  it("is 0 for an all-black frame", () => {
    const { mean, luma } = lumaOf(solid(0, 0, 0));
    expect(mean).toBe(0);
    expect(luma.every((v) => v === 0)).toBe(true);
  });

  it("is 255 for an all-white frame", () => {
    const { mean, luma } = lumaOf(solid(255, 255, 255));
    expect(mean).toBeCloseTo(255, 9);
    expect(luma.every((v) => v === 255)).toBe(true);
  });

  it("weights channels 0.299 / 0.587 / 0.114", () => {
    expect(lumaOf(solid(255, 0, 0)).mean).toBeCloseTo(76.245, 9);
    expect(lumaOf(solid(0, 255, 0)).mean).toBeCloseTo(149.685, 9);
    expect(lumaOf(solid(0, 0, 255)).mean).toBeCloseTo(29.07, 9);
  });

  it("ignores the alpha channel", () => {
    const rgba = solid(100, 100, 100);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 0;
    expect(lumaOf(rgba).mean).toBeCloseTo(100, 9);
  });

  it("averages a horizontal gradient", () => {
    // 256 grey pixels 0..255: mean is 127.5.
    const rgba = new Uint8ClampedArray(256 * 4);
    for (let p = 0; p < 256; p++) rgba.fill(p, p * 4, p * 4 + 3);
    const { mean, luma } = lumaOf(rgba);
    expect(mean).toBeCloseTo(127.5, 9);
    expect(luma[0]).toBe(0);
    expect(luma[200]).toBe(200);
    expect(luma[255]).toBe(255);
  });

  it("rounds stored luma to the nearest integer but keeps the exact mean", () => {
    // Pure red: 76.245 -> stored as 76, mean stays exact.
    const { mean, luma } = lumaOf(solid(255, 0, 0, 4));
    expect(Array.from(luma)).toEqual([76, 76, 76, 76]);
    expect(mean).toBeCloseTo(76.245, 9);
    // Pure blue: 29.07 -> 29; green: 149.685 -> 150 (rounds, not truncates).
    expect(lumaOf(solid(0, 255, 0, 1)).luma[0]).toBe(150);
  });

  it("rejects a buffer of the wrong size", () => {
    expect(() => computeLuma(new Uint8ClampedArray(8), new Uint8Array(3))).toThrow(RangeError);
  });
});

describe("meanMotion", () => {
  it("is 0 for identical frames", () => {
    const a = lumaOf(solid(90, 120, 30)).luma;
    expect(meanMotion(a, a.slice())).toBe(0);
  });

  it("is 255 between black and white, in both directions", () => {
    const black = new Uint8Array(100);
    const white = new Uint8Array(100).fill(255);
    expect(meanMotion(black, white)).toBe(255);
    expect(meanMotion(white, black)).toBe(255);
  });

  it("averages absolute differences", () => {
    const previous = Uint8Array.from([10, 10, 10, 10]);
    const current = Uint8Array.from([20, 0, 10, 50]); // diffs 10, 10, 0, 40
    expect(meanMotion(current, previous)).toBe(15);
  });

  it("rejects frames of different sizes", () => {
    expect(() => meanMotion(new Uint8Array(2), new Uint8Array(3))).toThrow(RangeError);
  });
});
