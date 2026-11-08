import type { Sample, Thresholds } from "../metrics/types";

/** Error from the backend's JSON envelope: {"error": {"code", "message", "details"?}}. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface SessionInfo {
  id: string;
  started_at: string;
  ended_at: string | null;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  ignored_after_stop: number;
}

export interface PublicConfig {
  thresholds: Thresholds;
  maxBatchSize: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function apiBaseUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (!base) throw new Error("VITE_API_BASE_URL is not set; see frontend/.env.example");
  return base.replace(/\/+$/, "");
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  keepalive?: boolean;
}

/**
 * fetch + JSON with a timeout. Throws ApiError for non-2xx responses; network failures and
 * timeouts surface as the browser's TypeError / DOMException (TimeoutError or AbortError).
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS, keepalive = false } = options;
  const response = await fetch(apiBaseUrl() + path, {
    method,
    keepalive,
    signal: AbortSignal.timeout(timeoutMs),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(
      response.status,
      body.error?.code ?? "http_error",
      body.error?.message ?? response.statusText,
    );
  } catch {
    return new ApiError(response.status, "http_error", response.statusText || "Request failed");
  }
}

export const api = {
  /** Cheap liveness ping; also wakes a sleeping free-tier backend. */
  health: (timeoutMs: number) => request<{ status: string }>("/healthz", { timeoutMs }),

  async config(): Promise<PublicConfig> {
    const raw = await request<{
      thresholds: {
        min_fps: number;
        min_brightness: number;
        max_brightness: number;
        max_motion: number;
      };
      max_batch_size: number;
    }>("/config");
    return {
      thresholds: {
        minFps: raw.thresholds.min_fps,
        minBrightness: raw.thresholds.min_brightness,
        maxBrightness: raw.thresholds.max_brightness,
        maxMotion: raw.thresholds.max_motion,
      },
      maxBatchSize: raw.max_batch_size,
    };
  },

  createSession: () => request<SessionInfo>("/sessions", { method: "POST" }),

  stopSession: (id: string) =>
    request<SessionInfo>(`/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" }),

  postSamples: (id: string, samples: readonly Sample[], keepalive = false) =>
    request<IngestResult>(`/sessions/${encodeURIComponent(id)}/samples`, {
      method: "POST",
      body: { samples },
      keepalive,
    }),
};
