import { useMemo, useState } from "react";
import type { Sample, Thresholds } from "../metrics/types";
import { formatLevel, verdictText } from "./format";
import { StatusStrip } from "./StatusStrip";
import { faceStrip, verdictStrip } from "./strips";
import { TimeChart } from "./TimeChart";

interface Props {
  samples: readonly Sample[];
  thresholds: Thresholds;
  /** Inclusive range of seconds to show. */
  from: number;
  to: number;
  syncKey: string;
}

/**
 * FPS, brightness and motion as three stacked charts sharing one time window and crosshair
 * (measures with different scales get their own charts, not extra y-axes), plus face and
 * verdict strips.
 */
export function QualityCharts({ samples, thresholds, from, to, syncKey }: Props) {
  const [plotBox, setPlotBox] = useState<{ left: number; width: number } | null>(null);

  const data = useMemo(() => {
    const visible = samples.filter((s) => s.t >= from && s.t <= to);
    return {
      visible,
      byT: new Map(visible.map((s) => [s.t, s])),
      x: visible.map((s) => s.t),
      fps: [{ label: "FPS", colorVar: "--series-1", values: visible.map((s) => s.fps) }],
      brightness: [
        { label: "Brightness", colorVar: "--series-2", values: visible.map((s) => s.brightness) },
      ],
      motion: [{ label: "Motion", colorVar: "--series-3", values: visible.map((s) => s.motion) }],
    };
  }, [samples, from, to]);
  // Half a second of padding so each second's strip cell is centred on its tick.
  const xRange = useMemo((): [number, number] => [from - 0.5, to + 0.5], [from, to]);

  return (
    <section className="charts" aria-label="Quality over time">
      <TimeChart
        title="Frames per second"
        x={data.x}
        series={data.fps}
        xRange={xRange}
        yRange={[0, 60]}
        thresholds={[{ value: thresholds.minFps, label: `min ${String(thresholds.minFps)}` }]}
        syncKey={syncKey}
        height={150}
        showXLabel={false}
      />
      <TimeChart
        title="Brightness (0–255)"
        x={data.x}
        series={data.brightness}
        xRange={xRange}
        yRange={[0, 255]}
        thresholds={[
          {
            value: thresholds.minBrightness,
            label: `too dark < ${String(thresholds.minBrightness)}`,
          },
          {
            value: thresholds.maxBrightness,
            label: `too bright > ${String(thresholds.maxBrightness)}`,
          },
        ]}
        syncKey={syncKey}
        height={150}
        showXLabel={false}
      />
      <TimeChart
        title="Motion"
        x={data.x}
        series={data.motion}
        xRange={xRange}
        // Real motion is small (a whole-frame mean): ~1 still, ~4 moving the head. The axis
        // starts at 0–10 and grows only if a value exceeds it.
        yRange={[0, 10]}
        thresholds={[
          { value: thresholds.maxMotion, label: `hold still > ${String(thresholds.maxMotion)}` },
        ]}
        syncKey={syncKey}
        onPlotBox={setPlotBox}
        height={170}
      />
      <StatusStrip {...faceStrip} from={from} to={to} byT={data.byT} plotBox={plotBox} />
      <StatusStrip {...verdictStrip} from={from} to={to} byT={data.byT} plotBox={plotBox} />

      <details className="data-table">
        <summary>Show these seconds as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">t (s)</th>
              <th scope="col">FPS</th>
              <th scope="col">Brightness</th>
              <th scope="col">Motion</th>
              <th scope="col">Face</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {data.visible.map((s) => (
              <tr key={s.t}>
                <td>{s.t}</td>
                <td>{s.fps.toFixed(1)}</td>
                <td>{formatLevel(s.brightness)}</td>
                <td>{formatLevel(s.motion)}</td>
                <td>{s.face ? "Yes" : "No face"}</td>
                <td>{verdictText(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
