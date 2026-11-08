/** Shapes shared by the metric code, the UI and the API client. Mirrors backend/app/schemas.py. */

/** In the spec's priority order: when several metrics fail, the first one is reported. */
export const REASONS = ["no_face", "too_dark", "too_bright", "hold_still", "low_fps"] as const;
export type Reason = (typeof REASONS)[number];

export type Verdict = "good" | "poor";

export interface Thresholds {
  minFps: number;
  minBrightness: number;
  maxBrightness: number;
  maxMotion: number;
}

/** One second of measurements, exactly as sent to the backend. */
export interface Sample {
  /** Whole seconds since session start; the first completed second is 1. */
  t: number;
  fps: number;
  /** null when no frame was processed in this second. */
  brightness: number | null;
  /** null when this second had no pair of consecutive frames to compare. */
  motion: number | null;
  face: boolean;
  verdict: Verdict;
  reason: Reason | null;
}
