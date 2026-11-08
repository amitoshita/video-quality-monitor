import { addFrame, aggregateSecond, createTotals, resetTotals } from "../metrics/aggregate";
import type { Sample, Thresholds } from "../metrics/types";

/**
 * Buckets processed frames into whole seconds and emits one sample per completed second.
 *
 * Second t covers [start + 1000·(t−1), start + 1000·t) on the monotonic clock, so the first
 * completed second is t = 1 and "duration = t of the last sample" holds exactly. Boundaries
 * are computed from the start time, never by chaining timers, so they don't drift.
 *
 * Seconds are closed when a frame from a later second arrives or when tick() is called (a
 * ~250 ms timer), so seconds with no frames at all still produce an honest fps: 0 sample.
 * After a stall (hidden tab, frozen camera) tick() catches up on every missed second.
 */
export class SecondAggregator {
  private readonly totals = createTotals();
  private nextT = 1;
  private readonly startMs: number;
  private readonly limits: Thresholds;
  private readonly emit: (sample: Sample) => void;

  constructor(startMs: number, limits: Thresholds, emit: (sample: Sample) => void) {
    this.startMs = startMs;
    this.limits = limits;
    this.emit = emit;
  }

  addFrame(nowMs: number, brightness: number, motion: number | null, face: boolean): void {
    if (nowMs < this.startMs) return; // a frame decoded before Start belongs to no second
    this.closeElapsed(nowMs);
    addFrame(this.totals, brightness, motion, face);
  }

  /** Emits every second that has fully elapsed by nowMs. */
  tick(nowMs: number): void {
    this.closeElapsed(nowMs);
  }

  private closeElapsed(nowMs: number): void {
    while (nowMs >= this.startMs + this.nextT * 1000) {
      this.emit(aggregateSecond(this.totals, this.nextT, this.limits));
      resetTotals(this.totals);
      this.nextT += 1;
    }
  }
}
