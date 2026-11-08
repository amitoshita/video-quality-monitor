import { useEffect, useState } from "react";
import type { PublicConfig } from "../api/client";
import { LiveSession } from "../pipeline/session";
import { HistoryList } from "./HistoryList";
import { LiveScreen } from "./LiveScreen";
import { SessionView } from "./SessionView";
import { href, useRoute, type Route } from "./router";
import { useBackend } from "./useBackend";

export function App() {
  const { state, retry } = useBackend();
  const route = useRoute();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Video Quality Monitor</h1>
        <p className="tagline">Video stays in your browser. Only the numbers are sent.</p>
        <Nav route={route} />
      </header>
      <main>
        {state.status === "ready" && <Ready config={state.config} route={route} />}
        {state.status === "waking" && <Waking />}
        {state.status === "unreachable" && (
          <div className="card" role="alert">
            <p>{state.message}</p>
            <button type="button" className="button button-start" onClick={retry}>
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function Nav({ route }: { route: Route }) {
  const onHistory = route.name !== "live";
  return (
    <nav className="app-nav" aria-label="Main">
      <a href={href.live} aria-current={onHistory ? undefined : "page"}>
        Live
      </a>
      <a href={href.history} aria-current={onHistory ? "page" : undefined}>
        History
      </a>
    </nav>
  );
}

/**
 * Everything that needs the backend's config. The LiveSession lives here, above the routes, so
 * a stopped session keeps delivering its samples while you browse History.
 */
function Ready({ config, route }: { config: PublicConfig; route: Route }) {
  // Created once; the constructor has no side effects, so StrictMode's double call is harmless.
  const [live] = useState(() => new LiveSession(config));

  useEffect(() => {
    live.preloadFaceDetector();
    return live.attachToPage();
  }, [live]);

  switch (route.name) {
    case "live":
      return <LiveScreen config={config} live={live} />;
    case "history":
      return <HistoryList />;
    case "session":
      return <SessionView id={route.id} config={config} />;
  }
}

/** Shown while the backend wakes up; counts seconds since it appeared. */
function Waking() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="card" role="status" aria-live="polite">
      <p>
        <strong>Waking up the server…</strong> {seconds > 2 && `${String(seconds)} s`}
      </p>
      <p className="hint">
        The free hosting plan puts the backend to sleep when idle, so the first visit can take up to
        a minute. The face detector is loading meanwhile.
      </p>
    </div>
  );
}
