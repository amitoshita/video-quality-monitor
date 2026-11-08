import type { Sample } from "../metrics/types";

interface Props {
  label: string;
  /** One cell per second from..to; seconds without a sample are blank. */
  from: number;
  to: number;
  byT: Map<number, Sample>;
  isOk: (sample: Sample) => boolean;
  describe: (sample: Sample) => string;
  plotBox: { left: number; width: number } | null;
}

/** A row of per-second cells aligned under the charts' plot area. Green = OK, red = not OK. */
export function StatusStrip({ label, from, to, byT, isOk, describe, plotBox }: Props) {
  const seconds = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  return (
    <div className="strip">
      <span className="strip-label" style={{ width: plotBox?.left }}>
        {label}
      </span>
      <ol
        className="strip-cells"
        style={{
          width: plotBox?.width,
          gridTemplateColumns: `repeat(${String(seconds.length)}, 1fr)`,
        }}
        aria-label={`${label} per second`}
      >
        {seconds.map((t) => {
          const sample = byT.get(t);
          if (!sample) return <li key={t} className="cell cell-empty" aria-hidden="true" />;
          const ok = isOk(sample);
          const text = `${String(t)} s: ${describe(sample)}`;
          return (
            <li key={t} className={ok ? "cell cell-ok" : "cell cell-bad"} title={text}>
              <span className="visually-hidden">{text}</span>
              <span aria-hidden="true">{seconds.length <= 60 ? (ok ? "✓" : "✕") : ""}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
