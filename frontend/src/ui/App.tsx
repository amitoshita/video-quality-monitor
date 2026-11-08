import { useEffect, useState } from "react";
import { LiveScreen } from "./LiveScreen";
import { useBackend } from "./useBackend";

export function App() {
  const { state, retry } = useBackend();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Video Quality Monitor</h1>
        <p className="tagline">Video stays in your browser. Only the numbers are sent.</p>
      </header>
      <main>
        {state.status === "ready" && <LiveScreen config={state.config} />}
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
