import { describe, expect, it } from "vitest";
import type { QueueStatus } from "../pipeline/sampleQueue";
import { deliveryText, formatLevel, verdictText } from "./format";

const healthy: QueueStatus = {
  pending: 0,
  sending: false,
  failures: 0,
  lastError: null,
  retryAt: null,
  dropped: 0,
};

describe("format", () => {
  it("never invents a number for an unmeasured value", () => {
    expect(formatLevel(null)).toBe("—");
    expect(formatLevel(0)).toBe("0.0");
    expect(formatLevel(132.44)).toBe("132.4");
  });

  it("phrases verdicts as 'Poor: <reason>'", () => {
    const base = { t: 1, fps: 30, brightness: 20, motion: 1, face: true } as const;
    expect(verdictText({ ...base, verdict: "good", reason: null })).toBe("Good");
    expect(verdictText({ ...base, verdict: "poor", reason: "too_dark" })).toBe("Poor: too dark");
    expect(verdictText({ ...base, verdict: "poor", reason: "no_face" })).toBe("Poor: no face");
  });

  it("summarises delivery state", () => {
    expect(deliveryText(null)).toBeNull();
    expect(deliveryText(healthy)).toEqual({ tone: "ok", text: "All samples delivered" });
    expect(deliveryText({ ...healthy, pending: 1 })).toEqual({
      tone: "busy",
      text: "1 sample pending",
    });
    expect(deliveryText({ ...healthy, pending: 3, failures: 2, dropped: 1 })).toEqual({
      tone: "warn",
      text: "Connection problem: 3 samples waiting, retrying · 1 sample dropped",
    });
  });
});
