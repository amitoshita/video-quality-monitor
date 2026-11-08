import type { IngestResult } from "../api/client";
import type { Sample } from "../metrics/types";
import { sampleProblem } from "../metrics/validate";

/** What happened to one POST of a batch. The transport maps HTTP outcomes onto these. */
export type SendOutcome =
  | { kind: "ok"; result: IngestResult }
  /** Network error, timeout or 5xx: keep the batch and try again later. */
  | { kind: "retry"; error: string }
  /** 4xx: retrying the same bytes cannot succeed, so this batch is dropped. */
  | { kind: "rejected"; error: string }
  /** 404: the session no longer exists; nothing more can be sent. */
  | { kind: "gone"; error: string };

export type Transport = (samples: readonly Sample[], keepalive: boolean) => Promise<SendOutcome>;

export interface QueueStatus {
  pending: number;
  sending: boolean;
  /** Consecutive failed attempts; 0 while healthy. */
  failures: number;
  lastError: string | null;
  /** When the next attempt may run (same clock as `now`), or null if not backing off. */
  retryAt: number | null;
  /** Samples dropped on purpose: invalid locally, rejected by the server, or after Stop. */
  dropped: number;
}

export interface QueueOptions {
  maxBatchSize: number;
  flushIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  random?: () => number;
  log?: (message: string, detail?: unknown) => void;
}

/**
 * In-memory outbound queue for samples, flushed in batches.
 *
 * - One request in flight at a time, so batches never race each other.
 * - Samples leave the queue only after a 2xx. The backend is idempotent on (session, t), so
 *   resending after a lost response is safe.
 * - Network errors, timeouts and 5xx keep the samples and back off exponentially with full
 *   jitter, capped. 4xx drops just that batch.
 * - Samples the backend would reject are skipped at enqueue time, so one bad sample can never
 *   make the backend reject a whole batch of good ones.
 */
export class SampleQueue {
  private readonly queue: Sample[] = [];
  private inFlight: Promise<void> | null = null;
  private failures = 0;
  private retryAt: number | null = null;
  private lastError: string | null = null;
  private dropped = 0;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Ends drain()'s wait for the next retry early (see retryNow). */
  private wakeDrain: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  private readonly transport: Transport;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly log: (message: string, detail?: unknown) => void;

  constructor(transport: Transport, options: QueueOptions) {
    this.transport = transport;
    this.maxBatchSize = options.maxBatchSize;
    this.flushIntervalMs = options.flushIntervalMs ?? 1500;
    this.baseBackoffMs = options.baseBackoffMs ?? 1500;
    // Capped low: samples arrive every second, and a backend waking from a cold start sends
    // no "online" event to cut a long backoff short.
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
    this.now = options.now ?? (() => performance.now());
    this.random = options.random ?? Math.random;
    this.log =
      options.log ??
      ((message, detail) => {
        console.warn(`[queue] ${message}`, detail);
      });
  }

  /** Starts periodic flushing. */
  start(): void {
    this.timer ??= setInterval(() => void this.flush(), this.flushIntervalMs);
  }

  /** Stops periodic flushing; queued samples are kept (see drain). */
  stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  enqueue(sample: Sample): void {
    if (this.closed) return;
    const problem = sampleProblem(sample);
    if (problem !== null) {
      this.dropped += 1;
      this.log(`skipping invalid sample t=${String(sample.t)}: ${problem}`, sample);
      this.notify();
      return;
    }
    this.queue.push(sample);
    this.notify();
  }

  /**
   * Sends the next batch if nothing is in flight and no backoff is pending. Resolves when that
   * attempt (if any) has finished. Never throws.
   */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.closed || this.queue.length === 0) return Promise.resolve();
    if (this.retryAt !== null && this.now() < this.retryAt) return Promise.resolve();

    const batch = this.queue.slice(0, this.maxBatchSize);
    this.inFlight = this.send(batch).finally(() => {
      this.inFlight = null;
      this.notify();
    });
    this.notify();
    return this.inFlight;
  }

  private async send(batch: Sample[]): Promise<void> {
    let outcome: SendOutcome;
    try {
      outcome = await this.transport(batch, false);
    } catch (error) {
      outcome = { kind: "retry", error: String(error) }; // a transport bug must not wedge the queue
    }

    switch (outcome.kind) {
      case "ok": {
        // Only this method removes from the front and it runs one at a time, so the first
        // batch.length entries are exactly the batch that was acknowledged.
        this.queue.splice(0, batch.length);
        this.resetBackoff();
        const ignored = outcome.result.ignored_after_stop;
        if (ignored > 0) {
          this.dropped += ignored;
          this.log(`${String(ignored)} samples arrived after the session ended and were ignored`);
        }
        return;
      }
      case "retry": {
        this.failures += 1;
        this.lastError = outcome.error;
        const ceiling = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** (this.failures - 1));
        this.retryAt = this.now() + this.random() * ceiling;
        return;
      }
      case "rejected": {
        this.queue.splice(0, batch.length);
        this.dropped += batch.length;
        this.resetBackoff();
        this.lastError = outcome.error;
        this.log(`server rejected a batch of ${String(batch.length)} samples`, outcome.error);
        return;
      }
      case "gone": {
        this.dropped += this.queue.length;
        this.queue.length = 0;
        this.lastError = outcome.error;
        this.closed = true;
        this.stopTimer();
        this.log("session no longer exists; dropping queued samples", outcome.error);
        return;
      }
    }
  }

  /**
   * Keeps flushing until the queue is empty or the deadline passes, honouring backoff but never
   * waiting past the deadline. Resolves true if everything was acknowledged.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    const deadline = this.now() + timeoutMs;
    while (this.queue.length > 0 && !this.closed) {
      const now = this.now();
      if (now >= deadline) break;
      if (!this.inFlight && this.retryAt !== null && now < this.retryAt) {
        await this.waitForRetry(Math.min(this.retryAt, deadline) - now);
        continue;
      }
      await this.flush();
    }
    return this.queue.length === 0;
  }

  /**
   * Skips the current backoff and sends now. Called when the browser reports it is back online,
   * so a long outage doesn't leave samples waiting out a backoff after the network returned.
   */
  retryNow(): void {
    if (this.retryAt === null) return;
    this.retryAt = null;
    this.wakeDrain?.();
    void this.flush();
  }

  private waitForRetry(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakeDrain = null;
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      this.wakeDrain = done;
    });
  }

  /**
   * Best effort for pagehide: fire one keepalive request with the oldest pending samples and
   * don't wait for it. keepalive bodies are capped at ~64 KB; a full batch is ~15 KB.
   */
  sendBeforeUnload(): void {
    if (this.closed || this.queue.length === 0) return;
    void this.transport(this.queue.slice(0, this.maxBatchSize), true).catch(() => {});
  }

  status(): QueueStatus {
    return {
      pending: this.queue.length,
      sending: this.inFlight !== null,
      failures: this.failures,
      lastError: this.lastError,
      retryAt: this.retryAt,
      dropped: this.dropped,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private resetBackoff(): void {
    this.failures = 0;
    this.retryAt = null;
    this.lastError = null;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
