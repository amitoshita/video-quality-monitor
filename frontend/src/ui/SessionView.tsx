import type { ReactNode } from "react";
import { api, ApiError, type PublicConfig } from "../api/client";
import { QualityCharts } from "./QualityCharts";
import { formatDateTime, formatDuration, formatStat } from "./format";
import { href } from "./router";
import { useLoad } from "./useLoad";

/** One session: the full chart (same style as live), its summary, and a way back. */
export function SessionView({ id, config }: { id: string; config: PublicConfig }) {
  const { state, reload } = useLoad(`session:${id}`, () => api.getSession(id));

  let body: ReactNode;
  if (state.status === "loading") {
    body = <p role="status">Loading session…</p>;
  } else if (state.status === "error") {
    const notFound = state.error instanceof ApiError && state.error.status === 404;
    body = (
      <div role="alert" className="notice notice-error">
        <p>{notFound ? "This session does not exist." : "Could not load this session."}</p>
        {!notFound && (
          <button type="button" className="button button-start" onClick={reload}>
            Try again
          </button>
        )}
      </div>
    );
  } else {
    const session = state.data;
    const { summary } = session;
    const lastT = session.samples.at(-1)?.t ?? 0;
    body = (
      <>
        <p className="session-times">
          Started {formatDateTime(session.started_at)} ·{" "}
          {session.ended_at
            ? `stopped ${formatDateTime(session.ended_at)}`
            : "not stopped (the tab was closed); it ends at its last sample"}
        </p>
        <dl className="tiles tiles-4">
          <Stat name="Duration" value={formatDuration(summary.duration_s)} />
          <Stat name="Average FPS" value={formatStat(summary.avg_fps)} />
          <Stat name="Seconds with a face" value={formatStat(summary.face_pct, "%")} />
          <Stat name="Seconds Good" value={formatStat(summary.good_pct, "%")} />
        </dl>
        {session.samples.length === 0 ? (
          <p>This session has no samples (it was stopped before the first full second).</p>
        ) : (
          <QualityCharts
            samples={session.samples}
            thresholds={config.thresholds}
            from={1}
            to={Math.max(lastT, 1)}
            syncKey="history"
          />
        )}
      </>
    );
  }

  return (
    <section className="panel" aria-labelledby="session-title">
      <div className="panel-heading">
        <a className="button button-secondary" href={href.history}>
          ← Back to history
        </a>
        <h2 id="session-title">Session</h2>
      </div>
      {body}
    </section>
  );
}

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div className="tile">
      <dt>{name}</dt>
      <dd className="tile-value">{value}</dd>
    </div>
  );
}
