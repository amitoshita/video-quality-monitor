import { useCallback, useEffect, useState } from "react";
import { api, type PublicConfig } from "../api/client";

export type BackendState =
  | { status: "waking" }
  | { status: "ready"; config: PublicConfig }
  | { status: "unreachable"; message: string };

/** Free-tier hosts can take up to a minute to wake up; give them a little more. */
const WAKE_BUDGET_MS = 90_000;
const PING_TIMEOUT_MS = 15_000;

/**
 * Pings /healthz until the backend answers (waking it if it sleeps), then loads /config, the
 * single source of the thresholds.
 */
export function useBackend(): { state: BackendState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BackendState>({ status: "waking" });

  useEffect(() => {
    const cancel = new AbortController();
    const isCancelled = () => cancel.signal.aborted; // re-read after every await
    const startedAt = Date.now();

    void (async () => {
      while (!isCancelled() && Date.now() - startedAt < WAKE_BUDGET_MS) {
        try {
          await api.health(PING_TIMEOUT_MS);
          const config = await api.config();
          if (!isCancelled()) setState({ status: "ready", config });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      if (!isCancelled()) {
        setState({
          status: "unreachable",
          message: "The server did not respond. Check your connection and try again.",
        });
      }
    })();

    return () => {
      cancel.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "waking" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}
