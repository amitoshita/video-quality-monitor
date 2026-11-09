import type { Sample } from "../metrics/types";

export interface ChartColumns {
  /** Every second from..to, so a missing second is a gap in the line, never a straight join. */
  x: number[];
  fps: (number | null)[];
  brightness: (number | null)[];
  motion: (number | null)[];
}

/** Lays samples out on one slot per second of [from, to]; seconds without a sample are null. */
export function chartColumns(
  byT: ReadonlyMap<number, Sample>,
  from: number,
  to: number,
): ChartColumns {
  const columns: ChartColumns = { x: [], fps: [], brightness: [], motion: [] };
  for (let t = from; t <= to; t++) {
    const sample = byT.get(t);
    columns.x.push(t);
    columns.fps.push(sample?.fps ?? null);
    columns.brightness.push(sample?.brightness ?? null);
    columns.motion.push(sample?.motion ?? null);
  }
  return columns;
}
