import { REASONS, type Sample } from "./types";

/** Field ranges accepted by the backend (backend/app/schemas.py and domain.py). */
export const SAMPLE_LIMITS = {
  maxT: 24 * 60 * 60,
  maxFps: 120,
  maxLevel: 255, // brightness and motion
} as const;

/**
 * Mirrors every rule the backend applies to a sample, field ranges and cross-field rules.
 * Returns the first problem found, or null if the backend would accept the sample.
 *
 * The queue calls this before accepting a sample: one bad sample in a batch makes the backend
 * reject the whole batch with a 422, and the client drops 4xx batches, so a sample that can't
 * pass must be caught here instead of costing up to a batch of good ones.
 */
export function sampleProblem(sample: Sample): string | null {
  // Checked as untrusted values: the point is to catch what the types say can't happen.
  const s: Record<keyof Sample, unknown> = sample;
  if (!Number.isInteger(s.t) || !inRange(s.t, SAMPLE_LIMITS.maxT)) return "t out of range";
  if (!inRange(s.fps, SAMPLE_LIMITS.maxFps)) return "fps out of range";
  if (s.brightness !== null && !inRange(s.brightness, SAMPLE_LIMITS.maxLevel)) {
    return "brightness out of range";
  }
  if (s.motion !== null && !inRange(s.motion, SAMPLE_LIMITS.maxLevel)) {
    return "motion out of range";
  }
  if (typeof s.face !== "boolean") return "face is not a boolean";
  if (s.verdict !== "good" && s.verdict !== "poor") return "unknown verdict";
  if (s.reason !== null && !(REASONS as readonly unknown[]).includes(s.reason)) {
    return "unknown reason";
  }
  if ((s.verdict === "good") !== (s.reason === null)) {
    return "reason must be null exactly when the verdict is good";
  }
  if (s.fps === 0 && (s.brightness !== null || s.motion !== null)) {
    return "a second without frames cannot have brightness or motion";
  }
  if (s.fps === 0 && s.face) return "a second without frames cannot have seen a face";
  if (s.fps !== 0 && s.brightness === null) {
    return "brightness is required when frames were processed";
  }
  return null;
}

export function isValidSample(sample: Sample): boolean {
  return sampleProblem(sample) === null;
}

function inRange(value: unknown, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}
