import { describe, expect, it } from "vitest";
import type { Sample } from "../metrics/types";
import { chartColumns } from "./chartData";

const sample = (t: number, fps: number): Sample => ({
  t,
  fps,
  brightness: fps === 0 ? null : 100,
  motion: fps === 0 ? null : 1,
  face: fps > 0,
  verdict: "poor",
  reason: "no_face",
});

describe("chartColumns", () => {
  it("gives every second a slot and leaves missing seconds empty", () => {
    const byT = new Map([1, 2, 5].map((t) => [t, sample(t, 30)]));

    expect(chartColumns(byT, 1, 5)).toEqual({
      x: [1, 2, 3, 4, 5],
      fps: [30, 30, null, null, 30],
      brightness: [100, 100, null, null, 100],
      motion: [1, 1, null, null, 1],
    });
  });

  it("keeps a measured 0 FPS second as 0, not as a gap", () => {
    const byT = new Map([[1, sample(1, 0)]]);

    expect(chartColumns(byT, 1, 1)).toEqual({
      x: [1],
      fps: [0],
      brightness: [null],
      motion: [null],
    });
  });
});
