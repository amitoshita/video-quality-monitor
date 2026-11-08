import { describe, expect, it } from "vitest";
import { computeVerdict, type SecondMetrics } from "./verdict";
import type { Thresholds } from "./types";

const limits: Thresholds = { minFps: 15, minBrightness: 60, maxBrightness: 200, maxMotion: 20 };
const ok: SecondMetrics = { fps: 30, brightness: 120, motion: 2, face: true };

const verdictOf = (overrides: Partial<SecondMetrics>) =>
  computeVerdict({ ...ok, ...overrides }, limits);

describe("computeVerdict", () => {
  it("is good when every metric is within limits", () => {
    expect(verdictOf({})).toEqual({ verdict: "good", reason: null });
  });

  it.each([
    [{ face: false }, "no_face"],
    [{ brightness: 10 }, "too_dark"],
    [{ brightness: 240 }, "too_bright"],
    [{ motion: 50 }, "hold_still"],
    [{ fps: 5 }, "low_fps"],
  ] as const)("reports %o as %s", (overrides, reason) => {
    expect(verdictOf(overrides)).toEqual({ verdict: "poor", reason });
  });

  describe("boundaries are inclusive (a value at the threshold is OK)", () => {
    it.each([
      ["fps", { fps: 15 }, { fps: 14.9 }, "low_fps"],
      ["min brightness", { brightness: 60 }, { brightness: 59.9 }, "too_dark"],
      ["max brightness", { brightness: 200 }, { brightness: 200.1 }, "too_bright"],
      ["motion", { motion: 20 }, { motion: 20.1 }, "hold_still"],
    ] as const)("%s", (_name, atLimit, beyond, reason) => {
      expect(verdictOf(atLimit).verdict).toBe("good");
      expect(verdictOf(beyond)).toEqual({ verdict: "poor", reason });
    });
  });

  describe("priority: no face > too dark/bright > hold still > low FPS", () => {
    it("no face beats everything", () => {
      expect(verdictOf({ face: false, brightness: 5, motion: 90, fps: 2 }).reason).toBe("no_face");
    });
    it("brightness beats motion and FPS", () => {
      expect(verdictOf({ brightness: 5, motion: 90, fps: 2 }).reason).toBe("too_dark");
      expect(verdictOf({ brightness: 250, motion: 90, fps: 2 }).reason).toBe("too_bright");
    });
    it("motion beats FPS", () => {
      expect(verdictOf({ motion: 90, fps: 2 }).reason).toBe("hold_still");
    });
  });

  it("treats unmeasured brightness or motion as not failing", () => {
    expect(verdictOf({ motion: null })).toEqual({ verdict: "good", reason: null });
    expect(verdictOf({ brightness: null, motion: null, fps: 20 }).verdict).toBe("good");
  });

  it("fails a second with no frames on face first", () => {
    expect(verdictOf({ fps: 0, brightness: null, motion: null, face: false })).toEqual({
      verdict: "poor",
      reason: "no_face",
    });
  });
});
