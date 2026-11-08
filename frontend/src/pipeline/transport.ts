import { api, ApiError } from "../api/client";
import type { SendOutcome, Transport } from "./sampleQueue";

/** Maps a failed POST onto what the queue should do with the batch. */
export function classifySendError(error: unknown): SendOutcome {
  if (error instanceof ApiError) {
    const message = `${String(error.status)} ${error.code}: ${error.message}`;
    if (error.status === 404) return { kind: "gone", error: message };
    // Timeouts and rate limits are transient even though they are 4xx.
    if (error.status === 408 || error.status === 429) return { kind: "retry", error: message };
    if (error.status >= 400 && error.status < 500) return { kind: "rejected", error: message };
    return { kind: "retry", error: message };
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { kind: "retry", error: "request timed out" };
  }
  // fetch rejects with TypeError when offline, on DNS/TLS failure, or when CORS blocks it.
  return { kind: "retry", error: error instanceof Error ? error.message : String(error) };
}

export function httpTransport(sessionId: string): Transport {
  return async (samples, keepalive) => {
    try {
      return { kind: "ok", result: await api.postSamples(sessionId, samples, keepalive) };
    } catch (error) {
      return classifySendError(error);
    }
  };
}
