import { describe, expect, it } from "vitest";
import {
  addFrame,
  aggregateSecond,
  clampRound,
  createTotals,
  resetTotals,
  sanitizeMetrics,
} from "./aggregate";
import type { Thresholds } from "./types";

const limits: Thresholds = { minFps: 15, minBrightness: 60, maxBrightness: 200, maxMotion: 20 };

function totalsWith(frames: [brightness: number, motion: number | null, face: boolean][]) {
  const totals = createTotals();
  for (const [b, m, f] of frames) addFrame(totals, b, m, f);
  return totals;
}

describe("aggregateSecond", () => {
  it("averages the frames of the second", () => {
    const frames = Array.from({ length: 20 }, (_, i): [number, number, boolean] => [
      100 + i,
      i % 4,
      true,
    ]);
    const sample = aggregateSecond(totalsWith(frames), 7, limits);
    expect(sample).toEqual({
      t: 7,
      fps: 20,
      brightness: 109.5, // mean of 100..119
      motion: 1.5, // mean of 0,1,2,3 repeated
      face: true,
      verdict: "good",
      reason: null,
    });
  });

  it("emits an honest sample for a second with no frames", () => {
    expect(aggregateSecond(createTotals(), 3, limits)).toEqual({
      t: 3,
      fps: 0,
      brightness: null,
      motion: null,
      face: false,
      verdict: "poor",
      reason: "no_face",
    });
  });

  it("leaves frames without a predecessor out of the motion mean (not as 0)", () => {
    // First frame of the session: no previous frame, so no motion value.
    const sample = aggregateSecond(
      totalsWith([
        [120, null, true],
        [120, 30, true],
        [120, 10, true],
      ]),
      1,
      limits,
    );
    expect(sample.motion).toBe(20);
    expect(sample.fps).toBe(3);
  });

  it("reports null motion when no frame had a predecessor", () => {
    const sample = aggregateSecond(totalsWith([[120, null, true]]), 1, limits);
    expect(sample.motion).toBeNull();
    expect(sample.brightness).toBe(120);
  });

  it("marks face true if any frame of the second had one", () => {
    const frames: [number, number, boolean][] = [
      [120, 1, false],
      [120, 1, true],
      [120, 1, false],
    ];
    expect(aggregateSecond(totalsWith(frames), 1, limits).face).toBe(true);
    expect(aggregateSecond(totalsWith([[120, 1, false]]), 1, limits).face).toBe(false);
  });

  it("computes the verdict from the rounded values that are shown", () => {
    // Raw mean 59.96 is below 60, but it is displayed and stored as 60.0, so it must be OK.
    const frames = Array.from({ length: 25 }, (): [number, number, boolean] => [59.96, 1, true]);
    const sample = aggregateSecond(totalsWith(frames), 1, limits);
    expect(sample.brightness).toBe(60);
    expect(sample.verdict).toBe("good");
  });

  it("resetTotals clears everything for the next second", () => {
    const totals = totalsWith([[120, 3, true]]);
    resetTotals(totals);
    expect(totals).toEqual(createTotals());
  });
});

describe("sanitizing before a sample is queued", () => {
  it("clamps into the backend's ranges", () => {
    expect(sanitizeMetrics({ fps: 144, brightness: 255.04, motion: -0.0001 })).toEqual({
      fps: 120,
      brightness: 255,
      motion: 0,
    });
    expect(sanitizeMetrics({ fps: -1, brightness: -3, motion: 300 })).toEqual({
      fps: 0,
      brightness: 0,
      motion: 255,
    });
  });

  it("rounds to one decimal", () => {
    expect(clampRound(132.44, 0, 255)).toBe(132.4);
    expect(clampRound(132.45, 0, 255)).toBe(132.5);
    expect(clampRound(29.6666, 0, 120)).toBe(29.7);
    expect(clampRound(0.04, 0, 255)).toBe(0);
  });

  it("never emits NaN or Infinity", () => {
    expect(clampRound(Number.NaN, 0, 255)).toBeNull();
    expect(clampRound(Number.POSITIVE_INFINITY, 0, 255)).toBeNull();
    expect(sanitizeMetrics({ fps: Number.NaN, brightness: null, motion: null }).fps).toBe(0);
  });

  it("keeps nulls as nulls and other fields untouched", () => {
    expect(sanitizeMetrics({ fps: 0, brightness: null, motion: null, face: false })).toEqual({
      fps: 0,
      brightness: null,
      motion: null,
      face: false,
    });
  });
});
