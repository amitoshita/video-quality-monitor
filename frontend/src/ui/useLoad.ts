import { useCallback, useEffect, useState } from "react";

export type Load<T> =
  { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: unknown };

/**
 * Runs `load` whenever `key` changes and tracks its state. A response that arrives after the
 * key changed (or after unmount) is ignored, so a slow request can't overwrite a newer one.
 */
export function useLoad<T>(
  key: string,
  load: () => Promise<T>,
): { state: Load<T>; reload: () => void } {
  const [result, setResult] = useState<{ key: string; state: Load<T> } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const cancel = new AbortController();
    load().then(
      (data) => {
        if (!cancel.signal.aborted) setResult({ key, state: { status: "ok", data } });
      },
      (error: unknown) => {
        if (!cancel.signal.aborted) setResult({ key, state: { status: "error", error } });
      },
    );
    return () => {
      cancel.abort();
    };
    // `load` is a new closure on every render; the key identifies what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const reload = useCallback(() => {
    setResult(null);
    setAttempt((n) => n + 1);
  }, []);
  // Until the result for the *current* key arrives, we are loading.
  const state: Load<T> = result?.key === key ? result.state : { status: "loading" };
  return { state, reload };
}
