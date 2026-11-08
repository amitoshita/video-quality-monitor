import { computeVerdict } from "./verdict";
import type { Sample, Thresholds } from "./types";

/**
 * Running totals for the second being measured. Mutated in place by addFrame and reset by
 * resetTotals, so the per-frame path allocates nothing.
 */
export interface SecondTotals {
  frames: number;
  brightnessSum: number;
  motionSum: number;
  /** Frames that had a previous frame to diff against (the first frame has none). */
  motionFrames: number;
  faceSeen: boolean;
}

export function createTotals(): SecondTotals {
  return { frames: 0, brightnessSum: 0, motionSum: 0, motionFrames: 0, faceSeen: false };
}

export function resetTotals(totals: SecondTotals): void {
  totals.frames = 0;
  totals.brightnessSum = 0;
  totals.motionSum = 0;
  totals.motionFrames = 0;
  totals.faceSeen = false;
}

export function addFrame(
  totals: SecondTotals,
  brightness: number,
  motion: number | null,
  face: boolean,
): void {
  totals.frames += 1;
  totals.brightnessSum += brightness;
  if (motion !== null) {
    totals.motionSum += motion;
    totals.motionFrames += 1;
  }
  if (face) totals.faceSeen = true;
}

/**
 * Turns one full second of totals into a sample.
 *
 * - fps is the number of frames actually processed (the window is exactly one second).
 * - brightness and motion are means over the frames that had them, or null if none did.
 * - face is true if any frame in the second had a face ("no face for the whole second").
 *
 * Values are clamped and rounded *before* the verdict, so the verdict always agrees with the
 * numbers that are shown and stored.
 */
export function aggregateSecond(totals: SecondTotals, t: number, limits: Thresholds): Sample {
  const metrics = sanitizeMetrics({
    fps: totals.frames,
    brightness: totals.frames > 0 ? totals.brightnessSum / totals.frames : null,
    motion: totals.motionFrames > 0 ? totals.motionSum / totals.motionFrames : null,
    face: totals.faceSeen,
  });
  return { t, ...metrics, ...computeVerdict(metrics, limits) };
}

/** Keeps values inside the backend's accepted ranges, rounded to 0.1. */
export function sanitizeMetrics<
  T extends { fps: number; brightness: number | null; motion: number | null },
>(m: T): T {
  return {
    ...m,
    fps: clampRound(m.fps, 0, 120) ?? 0,
    brightness: m.brightness === null ? null : clampRound(m.brightness, 0, 255),
    motion: m.motion === null ? null : clampRound(m.motion, 0, 255),
  };
}

/** Clamps to [min, max] and rounds to one decimal; non-finite input becomes null. */
export function clampRound(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null;
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(clamped * 10) / 10;
}
