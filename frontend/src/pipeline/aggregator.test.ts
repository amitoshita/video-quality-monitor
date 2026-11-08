import { describe, expect, it } from "vitest";
import type { Sample, Thresholds } from "../metrics/types";
import { SecondAggregator } from "./aggregator";

const limits: Thresholds = { minFps: 15, minBrightness: 60, maxBrightness: 200, maxMotion: 20 };
const START = 10_000; // arbitrary performance.now() value at Start

function setup() {
  const emitted: Sample[] = [];
  const aggregator = new SecondAggregator(START, limits, (s) => emitted.push(s));
  /** Adds `count` evenly spaced frames inside second t (1-based). */
  const framesInSecond = (t: number, count: number, face = true) => {
    for (let i = 0; i < count; i++) {
      aggregator.addFrame(START + (t - 1) * 1000 + (i * 1000) / count, 120, 2, face);
    }
  };
  return { aggregator, emitted, framesInSecond };
}

describe("SecondAggregator", () => {
  it("numbers the first completed second t = 1", () => {
    const { aggregator, emitted, framesInSecond } = setup();
    framesInSecond(1, 30);
    expect(emitted).toEqual([]); // second 1 isn't over yet

    aggregator.tick(START + 1000);

    expect(emitted.map((s) => [s.t, s.fps])).toEqual([[1, 30]]);
  });

  it("emits one sample per second with the frames counted in that second", () => {
    const { aggregator, emitted, framesInSecond } = setup();
    framesInSecond(1, 30);
    framesInSecond(2, 24);
    framesInSecond(3, 12);
    aggregator.tick(START + 3000);

    expect(emitted.map((s) => [s.t, s.fps, s.reason])).toEqual([
      [1, 30, null],
      [2, 24, null],
      [3, 12, "low_fps"],
    ]);
  });

  it("puts a frame exactly on a boundary into the next second", () => {
    const { aggregator, emitted } = setup();
    aggregator.addFrame(START + 999.9, 120, 1, true);
    aggregator.addFrame(START + 1000, 120, 1, true);
    aggregator.tick(START + 2000);

    expect(emitted.map((s) => s.fps)).toEqual([1, 1]);
  });

  it("emits fps 0 samples for seconds with no frames, catching up after a stall", () => {
    const { aggregator, emitted, framesInSecond } = setup();
    framesInSecond(1, 30);
    // Tab hidden: no frames for seconds 2-4, the timer only runs again at 4.2 s.
    aggregator.tick(START + 4200);

    expect(emitted.map((s) => s.t)).toEqual([1, 2, 3, 4]);
    expect(emitted[1]).toEqual({
      t: 2,
      fps: 0,
      brightness: null,
      motion: null,
      face: false,
      verdict: "poor",
      reason: "no_face",
    });
  });

  it("closes elapsed seconds when a late frame arrives, without a tick", () => {
    const { aggregator, emitted } = setup();
    aggregator.addFrame(START + 100, 120, 1, true);
    aggregator.addFrame(START + 2500, 120, 1, true); // second 3

    expect(emitted.map((s) => [s.t, s.fps])).toEqual([
      [1, 1],
      [2, 0],
    ]);
  });

  it("does not drift: boundaries come from the start time, not from tick timing", () => {
    const { aggregator, emitted } = setup();
    // Ticks arriving late and irregularly still produce exactly one sample per second.
    for (const at of [1013, 2290, 2295, 3999, 4001, 6750]) aggregator.tick(START + at);
    expect(emitted.map((s) => s.t)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("drops the partial last second (nothing is emitted until a second completes)", () => {
    const { aggregator, emitted, framesInSecond } = setup();
    framesInSecond(1, 30);
    framesInSecond(2, 9); // Stop pressed 0.3 s into second 2
    aggregator.tick(START + 1300);

    expect(emitted.map((s) => s.t)).toEqual([1]);
  });

  it("ignores frames from before the session started", () => {
    const { aggregator, emitted } = setup();
    aggregator.addFrame(START - 5, 120, 1, true);
    aggregator.tick(START + 1000);

    expect(emitted[0]?.fps).toBe(0);
  });

  it("sets face if any frame of the second had one", () => {
    const { aggregator, emitted } = setup();
    aggregator.addFrame(START + 100, 120, 1, false);
    aggregator.addFrame(START + 500, 120, 1, true);
    aggregator.addFrame(START + 900, 120, 1, false);
    aggregator.addFrame(START + 1100, 120, 1, false);
    aggregator.tick(START + 2000);

    expect(emitted.map((s) => s.face)).toEqual([true, false]);
  });
});
