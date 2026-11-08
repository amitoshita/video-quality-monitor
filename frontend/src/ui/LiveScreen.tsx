import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PublicConfig } from "../api/client";
import { LiveSession, RECENT_SECONDS, type LiveState } from "../pipeline/session";
import { MetricsPanel } from "./MetricsPanel";
import { QualityCharts } from "./QualityCharts";
import { ThresholdsTable } from "./ThresholdsTable";
import { deliveryText, plural } from "./format";

const START_LABELS: Record<NonNullable<LiveState["startStep"]>, string> = {
  camera: "Waiting for the camera…",
  detector: "Loading face detector…",
  session: "Starting session…",
};

export function LiveScreen({ config }: { config: PublicConfig }) {
  // Created once; the constructor has no side effects, so StrictMode's double call is harmless.
  const [live] = useState(() => new LiveSession(config));
  const state = useSyncExternalStore(live.subscribe, live.getState);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    live.preloadFaceDetector();
    return live.attachToPage();
  }, [live]);

  const running = state.phase === "running";
  const latest = state.recent.at(-1) ?? null;
  const lastT = latest?.t ?? 0;
  const to = Math.max(RECENT_SECONDS, lastT);
  const delivery = deliveryText(state.queue);

  const onToggle = () => {
    const video = videoRef.current;
    if (running) void live.stop();
    else if (video) void live.start(video);
  };

  return (
    <div className="live">
      <section className="stage" aria-label="Camera">
        <div className="preview-frame">
          {/* Mirrored for a natural selfie view. CSS only: analysis reads the unmirrored frame. */}
          <video ref={videoRef} className="preview" muted playsInline aria-label="Camera preview" />
          {!running && (
            <div className="preview-placeholder">
              {state.phase === "starting"
                ? START_LABELS[state.startStep ?? "camera"]
                : "Camera off"}
            </div>
          )}
        </div>

        <div className="controls">
          <button
            type="button"
            className={running ? "button button-stop" : "button button-start"}
            onClick={onToggle}
            disabled={state.phase === "starting"}
            aria-busy={state.phase === "starting"}
          >
            {state.phase === "starting"
              ? START_LABELS[state.startStep ?? "camera"]
              : running
                ? "Stop"
                : "Start"}
          </button>
          {state.phase === "idle" && state.detector.status === "loading" && (
            <span className="hint">Loading face detector in the background…</span>
          )}
        </div>

        <ul className="facts" aria-label="Session details">
          {state.resolution && (
            <li>
              Camera: {state.resolution.width}×{state.resolution.height}
            </li>
          )}
          {running && state.frameMode && (
            <li>
              Frames:{" "}
              {state.frameMode === "rvfc" ? "requestVideoFrameCallback" : "requestAnimationFrame"}
            </li>
          )}
          {state.detector.delegate && <li>Face detection: {state.detector.delegate}</li>}
          {delivery && (
            <li className={`delivery delivery-${delivery.tone}`} role="status">
              {delivery.text}
            </li>
          )}
        </ul>
      </section>

      <div className="readout">
        {state.message && (
          <p className={`notice notice-${state.message.kind}`} role="alert">
            {state.message.text}
          </p>
        )}
        {state.detector.status === "failed" && state.detector.error && state.message === null && (
          <p className="notice notice-error" role="alert">
            {state.detector.error}
          </p>
        )}
        {running && state.hidden && (
          <p className="notice notice-info" role="status">
            Paused while this tab is hidden: browsers stop delivering video frames to background
            tabs, so these seconds are recorded honestly as 0 FPS.
          </p>
        )}
        {state.backgroundPending > 0 && (
          <p className="notice notice-info" role="status">
            Previous session: {plural(state.backgroundPending, "sample")} still sending.
          </p>
        )}

        <MetricsPanel sample={latest} thresholds={config.thresholds} running={running} />
        <ThresholdsTable thresholds={config.thresholds} />
      </div>

      <QualityCharts
        samples={state.recent}
        thresholds={config.thresholds}
        from={to - RECENT_SECONDS + 1}
        to={to}
        syncKey="live"
      />
    </div>
  );
}
