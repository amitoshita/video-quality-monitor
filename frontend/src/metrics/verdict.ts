import type { Reason, Thresholds, Verdict } from "./types";

export interface SecondMetrics {
  fps: number;
  brightness: number | null;
  motion: number | null;
  face: boolean;
}

/**
 * Good only when every metric is within its limit. Limits are inclusive: a value exactly at
 * a threshold is OK ("below 15" means fps < 15). A null metric could not be measured and is
 * not a failure by itself; a second without frames still fails on face and FPS.
 *
 * Reasons are checked in the spec's priority order and the first failing one is reported.
 */
export function computeVerdict(
  m: SecondMetrics,
  limits: Thresholds,
): { verdict: Verdict; reason: Reason | null } {
  const reason = firstFailure(m, limits);
  return reason === null ? { verdict: "good", reason: null } : { verdict: "poor", reason };
}

function firstFailure(m: SecondMetrics, limits: Thresholds): Reason | null {
  if (!m.face) return "no_face";
  if (m.brightness !== null && m.brightness < limits.minBrightness) return "too_dark";
  if (m.brightness !== null && m.brightness > limits.maxBrightness) return "too_bright";
  if (m.motion !== null && m.motion > limits.maxMotion) return "hold_still";
  if (m.fps < limits.minFps) return "low_fps";
  return null;
}
