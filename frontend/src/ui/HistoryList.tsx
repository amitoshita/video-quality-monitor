import { useState } from "react";
import { api } from "../api/client";
import { formatDateTime, formatDuration, formatStat } from "./format";
import { href } from "./router";
import { useLoad } from "./useLoad";

const PAGE_SIZE = 20;

/** All sessions, newest first, with the backend-computed summary of each. */
export function HistoryList() {
  const [offset, setOffset] = useState(0);
  const { state, reload } = useLoad(`sessions:${String(offset)}`, () =>
    api.listSessions(PAGE_SIZE, offset),
  );

  return (
    <section className="panel" aria-labelledby="history-title">
      <h2 id="history-title">Session history</h2>

      {state.status === "loading" && <p role="status">Loading sessions…</p>}

      {state.status === "error" && (
        <div role="alert" className="notice notice-error">
          <p>Could not load the sessions.</p>
          <button type="button" className="button button-start" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      {state.status === "ok" && state.data.total === 0 && <p>No sessions yet.</p>}

      {state.status === "ok" && state.data.total > 0 && (
        <>
          <div className="table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Date and time</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Average FPS</th>
                  <th scope="col">Good</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((session) => (
                  <tr
                    key={session.id}
                    className="history-row"
                    onClick={() => {
                      window.location.hash = href.session(session.id);
                    }}
                  >
                    <td>
                      {/* The link makes each row reachable and openable by keyboard. */}
                      <a href={href.session(session.id)}>{formatDateTime(session.started_at)}</a>
                    </td>
                    <td>{formatDuration(session.summary.duration_s)}</td>
                    <td>{formatStat(session.summary.avg_fps)}</td>
                    <td>{formatStat(session.summary.good_pct, "%")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="Pages">
            <button
              type="button"
              className="button button-secondary"
              disabled={offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - PAGE_SIZE));
              }}
            >
              Newer
            </button>
            <span>
              {offset + 1}–{offset + state.data.items.length} of {state.data.total}
            </span>
            <button
              type="button"
              className="button button-secondary"
              disabled={offset + PAGE_SIZE >= state.data.total}
              onClick={() => {
                setOffset(offset + PAGE_SIZE);
              }}
            >
              Older
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
