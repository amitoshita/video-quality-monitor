import type { Sample, Thresholds } from "../metrics/types";
import { formatLevel, verdictText } from "./format";

type Tone = "ok" | "bad" | "none";

interface Tile {
  name: string;
  value: string;
  limit: string;
  tone: Tone;
}

function tiles(sample: Sample | null, limits: Thresholds): Tile[] {
  const tone = (failing: boolean | null): Tone =>
    failing === null ? "none" : failing ? "bad" : "ok";
  const b = sample?.brightness ?? null;
  const m = sample?.motion ?? null;
  return [
    {
      name: "FPS",
      value: sample ? sample.fps.toFixed(1) : "—",
      limit: `at least ${String(limits.minFps)}`,
      tone: tone(sample ? sample.fps < limits.minFps : null),
    },
    {
      name: "Brightness",
      value: formatLevel(b),
      limit: `${String(limits.minBrightness)}–${String(limits.maxBrightness)}`,
      tone: tone(b === null ? null : b < limits.minBrightness || b > limits.maxBrightness),
    },
    {
      name: "Motion",
      value: formatLevel(m),
      limit: `at most ${String(limits.maxMotion)}`,
      tone: tone(m === null ? null : m > limits.maxMotion),
    },
    {
      name: "Face",
      value: sample ? (sample.face ? "Face" : "No face") : "—",
      limit: "at least one face",
      tone: tone(sample ? !sample.face : null),
    },
  ];
}

const ICON: Record<Tone, string> = { ok: "✓", bad: "✕", none: "" };

/** The verdict for the last completed second and the four metrics behind it. */
export function MetricsPanel(props: {
  sample: Sample | null;
  thresholds: Thresholds;
  running: boolean;
}) {
  const { sample, thresholds, running } = props;
  const verdictTone = sample === null ? "none" : sample.verdict === "good" ? "ok" : "bad";
  return (
    <section className="metrics" aria-label="Current quality">
      <p className={`verdict verdict-${verdictTone}`} aria-live="polite">
        <span aria-hidden="true">{ICON[verdictTone]} </span>
        {sample
          ? verdictText(sample)
          : running
            ? "Measuring the first second…"
            : "Press Start to measure"}
        {sample && <span className="verdict-t"> · second {sample.t}</span>}
      </p>
      <dl className="tiles">
        {tiles(sample, thresholds).map((tile) => (
          <div key={tile.name} className={`tile tile-${tile.tone}`}>
            <dt>{tile.name}</dt>
            <dd className="tile-value">
              <span aria-hidden="true">{ICON[tile.tone]} </span>
              {tile.value}
            </dd>
            <dd className="tile-limit">OK: {tile.limit}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
