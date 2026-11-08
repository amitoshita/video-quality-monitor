import type { Thresholds } from "../metrics/types";

/** The thresholds in use, as served by the backend's /config (set from environment variables). */
export function ThresholdsTable({ thresholds: t }: { thresholds: Thresholds }) {
  const rows: [string, string, string][] = [
    ["No face", "no face detected in any frame of the second", "—"],
    ["Too dark", `brightness < ${String(t.minBrightness)}`, "MIN_BRIGHTNESS"],
    ["Too bright", `brightness > ${String(t.maxBrightness)}`, "MAX_BRIGHTNESS"],
    ["Hold still", `motion > ${String(t.maxMotion)}`, "MAX_MOTION"],
    ["Low FPS", `fps < ${String(t.minFps)}`, "MIN_FPS"],
  ];
  return (
    <section className="thresholds" aria-labelledby="thresholds-title">
      <h2 id="thresholds-title">Thresholds in use</h2>
      <table>
        <caption>
          A second is Poor if any rule matches; the first match (in this order) is the reason.
        </caption>
        <thead>
          <tr>
            <th scope="col">Reason</th>
            <th scope="col">Poor when</th>
            <th scope="col">Setting</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([reason, rule, env]) => (
            <tr key={reason}>
              <td>{reason}</td>
              <td>{rule}</td>
              <td>
                <code>{env}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
