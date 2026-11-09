import { describe, expect, it } from "vitest";
import { addFrame, aggregateSecond, createTotals } from "./aggregate";
import type { Sample, Thresholds } from "./types";
import { isValidSample, sampleProblem } from "./validate";

const good: Sample = {
  t: 12,
  fps: 29.6,
  brightness: 132.4,
  motion: 3.1,
  face: true,
  verdict: "good",
  reason: null,
};
const emptySecond: Sample = {
  t: 3,
  fps: 0,
  brightness: null,
  motion: null,
  face: false,
  verdict: "poor",
  reason: "no_face",
};

describe("isValidSample mirrors the backend's rules", () => {
  it("accepts valid samples, including edge values", () => {
    expect(isValidSample(good)).toBe(true);
    expect(isValidSample(emptySecond)).toBe(true);
    expect(isValidSample({ ...good, motion: null })).toBe(true); // first frame had no predecessor
    expect(isValidSample({ ...good, t: 0, fps: 120, brightness: 255, motion: 0 })).toBe(true);
    expect(isValidSample({ ...good, t: 86400, brightness: 0, motion: 255 })).toBe(true);
  });

  it.each<[string, Partial<Sample>]>([
    ["negative t", { t: -1 }],
    ["fractional t", { t: 1.5 }],
    ["t too large", { t: 86401 }],
    ["fps above 120", { fps: 120.1 }],
    ["negative fps", { fps: -0.1 }],
    ["NaN fps", { fps: Number.NaN }],
    ["brightness above 255", { brightness: 255.1 }],
    ["Infinity brightness", { brightness: Number.POSITIVE_INFINITY }],
    ["negative motion", { motion: -1 }],
    ["NaN motion", { motion: Number.NaN }],
    ["reason with good", { reason: "too_dark" }],
    ["poor without reason", { verdict: "poor" }],
    ["unknown verdict", { verdict: "ok" as Sample["verdict"] }],
    ["unknown reason", { verdict: "poor", reason: "blurry" as Sample["reason"] }],
    ["non-boolean face", { face: 1 as unknown as boolean }],
    // The case from the review: NaN brightness sanitised to null while frames were processed.
    ["frames but no brightness", { brightness: null }],
    ["no frames but brightness", { ...emptySecond, brightness: 10 }],
    ["no frames but motion", { ...emptySecond, motion: 1 }],
    ["no frames but a face", { ...emptySecond, face: true, reason: "low_fps" }],
  ])("rejects %s", (_name, overrides) => {
    const sample = { ...good, ...overrides };
    expect(isValidSample(sample)).toBe(false);
    expect(sampleProblem(sample)).toEqual(expect.any(String));
  });
});

describe("samples built by aggregateSecond", () => {
  const limits: Thresholds = { minFps: 15, minBrightness: 60, maxBrightness: 200, maxMotion: 20 };

  it("are valid for normal and empty seconds", () => {
    const totals = createTotals();
    addFrame(totals, 120, null, true);
    addFrame(totals, 121, 4, false);
    expect(isValidSample(aggregateSecond(totals, 1, limits))).toBe(true);
    expect(isValidSample(aggregateSecond(createTotals(), 2, limits))).toBe(true);
  });

  it("are flagged invalid if a NaN ever reaches brightness", () => {
    const totals = createTotals();
    addFrame(totals, Number.NaN, 1, true);
    const sample = aggregateSecond(totals, 1, limits);
    expect(sample.brightness).toBeNull();
    expect(sampleProblem(sample)).toBe("brightness is required when frames were processed");
  });
});
