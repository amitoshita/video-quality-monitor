import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sample } from "../metrics/types";
import { SampleQueue, type SendOutcome, type Transport } from "./sampleQueue";

function sample(t: number, overrides: Partial<Sample> = {}): Sample {
  return {
    t,
    fps: 30,
    brightness: 120,
    motion: 2,
    face: true,
    verdict: "good",
    reason: null,
    ...overrides,
  };
}

const ok = (accepted: number, ignored = 0): SendOutcome => ({
  kind: "ok",
  result: { accepted, duplicates: 0, ignored_after_stop: ignored },
});

/** A transport whose responses the test resolves by hand, recording every call. */
function manualTransport() {
  const calls: { ts: number[]; keepalive: boolean; resolve: (o: SendOutcome) => void }[] = [];
  const transport: Transport = (samples, keepalive) =>
    new Promise((resolve) => calls.push({ ts: samples.map((s) => s.t), keepalive, resolve }));
  return { transport, calls };
}

function makeQueue(transport: Transport, overrides = {}) {
  const log = vi.fn();
  const queue = new SampleQueue(transport, {
    maxBatchSize: 3,
    now: () => Date.now(),
    random: () => 1, // deterministic: always the full backoff ceiling
    log,
    ...overrides,
  });
  return { queue, log };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SampleQueue", () => {
  it("removes samples only after a 2xx", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport);
    queue.enqueue(sample(1));
    queue.enqueue(sample(2));

    const flushing = queue.flush();
    expect(queue.status()).toMatchObject({ pending: 2, sending: true });

    calls[0]?.resolve(ok(2));
    await flushing;
    expect(queue.status()).toMatchObject({ pending: 0, sending: false, failures: 0 });
  });

  it("keeps at most one request in flight", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport);
    queue.enqueue(sample(1));

    const first = queue.flush();
    queue.enqueue(sample(2));
    void queue.flush();
    void queue.flush();
    expect(calls).toHaveLength(1);

    calls[0]?.resolve(ok(1));
    await first;
    void queue.flush();
    expect(calls.map((c) => c.ts)).toEqual([[1], [2]]);
  });

  it("caps the batch size and sends the oldest samples first", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport);
    for (let t = 1; t <= 5; t++) queue.enqueue(sample(t));

    const first = queue.flush();
    calls[0]?.resolve(ok(3));
    await first;
    const second = queue.flush();
    calls[1]?.resolve(ok(2));
    await second;

    expect(calls.map((c) => c.ts)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it("keeps samples on a retryable failure and resends them with newer ones", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport, { maxBatchSize: 10 });
    queue.enqueue(sample(1));
    queue.enqueue(sample(2));

    const first = queue.flush();
    calls[0]?.resolve({ kind: "retry", error: "network down" });
    await first;
    queue.enqueue(sample(3));
    expect(queue.status()).toMatchObject({ pending: 3, failures: 1, lastError: "network down" });

    vi.setSystemTime(1500);
    const second = queue.flush();
    calls[1]?.resolve(ok(3));
    await second;

    expect(calls.map((c) => c.ts)).toEqual([
      [1, 2],
      [1, 2, 3],
    ]);
    expect(queue.status()).toMatchObject({ pending: 0, failures: 0, lastError: null });
  });

  it("backs off exponentially, capped, before retrying", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport, { baseBackoffMs: 1000, maxBackoffMs: 4000 });
    queue.enqueue(sample(1));

    const retryAts: (number | null)[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      vi.setSystemTime(queue.status().retryAt ?? 0);
      const flushing = queue.flush();
      calls[attempt]?.resolve({ kind: "retry", error: "503" });
      await flushing;
      retryAts.push(queue.status().retryAt);
    }
    // Delays 1000, 2000, 4000, then capped at 4000 (random() = 1 picks the ceiling).
    expect(retryAts).toEqual([1000, 3000, 7000, 11000]);

    // Before retryAt, flush does nothing.
    vi.setSystemTime(10_999);
    await queue.flush();
    expect(calls).toHaveLength(4);
  });

  it("caps the backoff at 10 s by default", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport, { baseBackoffMs: 1500 });
    queue.enqueue(sample(1));
    for (let attempt = 0; attempt < 8; attempt++) {
      vi.setSystemTime(queue.status().retryAt ?? 0);
      const flushing = queue.flush();
      calls[attempt]?.resolve({ kind: "retry", error: "offline" });
      await flushing;
    }
    const now = Date.now();
    expect((queue.status().retryAt ?? 0) - now).toBe(10_000);
  });

  it("retryNow skips the backoff and sends immediately", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport, { baseBackoffMs: 8000 });
    queue.enqueue(sample(1));
    const first = queue.flush();
    calls[0]?.resolve({ kind: "retry", error: "offline" });
    await first;
    expect(queue.status().retryAt).toBe(8000);

    queue.retryNow();

    expect(calls).toHaveLength(2);
    calls[1]?.resolve(ok(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.status()).toMatchObject({ pending: 0, failures: 0, retryAt: null });
  });

  it("applies jitter within the backoff ceiling", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport, { baseBackoffMs: 1000, random: () => 0.25 });
    queue.enqueue(sample(1));

    const flushing = queue.flush();
    calls[0]?.resolve({ kind: "retry", error: "timeout" });
    await flushing;

    expect(queue.status().retryAt).toBe(250);
  });

  it("treats a throwing transport as retryable instead of getting stuck", async () => {
    const { queue } = makeQueue(() => Promise.reject(new TypeError("Failed to fetch")));
    queue.enqueue(sample(1));

    await queue.flush();

    expect(queue.status()).toMatchObject({ pending: 1, sending: false, failures: 1 });
    expect(queue.status().lastError).toContain("Failed to fetch");
  });

  it("drops only the rejected batch on a 4xx and keeps the rest", async () => {
    const { transport, calls } = manualTransport();
    const { queue, log } = makeQueue(transport, { maxBatchSize: 2 });
    for (let t = 1; t <= 3; t++) queue.enqueue(sample(t));

    const flushing = queue.flush();
    calls[0]?.resolve({ kind: "rejected", error: "validation_error" });
    await flushing;

    expect(queue.status()).toMatchObject({ pending: 1, dropped: 2, failures: 0 });
    expect(log).toHaveBeenCalled();
  });

  it("stops sending once the session is gone (404)", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport, { maxBatchSize: 2 });
    for (let t = 1; t <= 3; t++) queue.enqueue(sample(t));

    const flushing = queue.flush();
    calls[0]?.resolve({ kind: "gone", error: "session_not_found" });
    await flushing;
    queue.enqueue(sample(4));
    await queue.flush();

    expect(calls).toHaveLength(1);
    expect(queue.status()).toMatchObject({ pending: 0, dropped: 3 });
  });

  it("counts samples the server ignored after Stop as dropped", async () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport);
    queue.enqueue(sample(1));
    queue.enqueue(sample(2));

    const flushing = queue.flush();
    calls[0]?.resolve(ok(0, 2));
    await flushing;

    expect(queue.status()).toMatchObject({ pending: 0, dropped: 2 });
  });

  it("skips a sample the backend would reject, without affecting the others", () => {
    const { transport, calls } = manualTransport();
    const { queue, log } = makeQueue(transport);
    queue.enqueue(sample(1));
    queue.enqueue(sample(2, { brightness: null })); // frames processed but no brightness
    queue.enqueue(sample(3));

    void queue.flush();

    expect(calls[0]?.ts).toEqual([1, 3]);
    expect(queue.status().dropped).toBe(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("skipping invalid sample t=2"),
      expect.anything(),
    );
  });

  it("flushes on its interval once started", async () => {
    const send = vi.fn<Transport>(() => Promise.resolve(ok(1)));
    const { queue } = makeQueue(send);
    queue.start();
    queue.enqueue(sample(1));

    await vi.advanceTimersByTimeAsync(1499);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);

    queue.stopTimer();
    queue.enqueue(sample(2));
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  describe("drain", () => {
    it("retries through failures until the queue is empty", async () => {
      const outcomes: SendOutcome[] = [
        { kind: "retry", error: "offline" },
        { kind: "retry", error: "offline" },
        ok(2),
      ];
      const send = vi.fn<Transport>(() => Promise.resolve(outcomes.shift() ?? ok(0)));
      const { queue } = makeQueue(send, { baseBackoffMs: 500 });
      queue.enqueue(sample(1));
      queue.enqueue(sample(2));

      const drained = queue.drain(5000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(await drained).toBe(true);
      expect(send).toHaveBeenCalledTimes(3);
    });

    it("gives up at the deadline and keeps the samples", async () => {
      const send = vi.fn<Transport>(() => Promise.resolve({ kind: "retry", error: "offline" }));
      const { queue } = makeQueue(send, { baseBackoffMs: 1000 });
      queue.enqueue(sample(1));

      const drained = queue.drain(5000);
      await vi.advanceTimersByTimeAsync(6000);

      expect(await drained).toBe(false);
      expect(Date.now()).toBeGreaterThanOrEqual(5000);
      expect(queue.status().pending).toBe(1);
    });

    it("wakes up from a backoff wait when retryNow is called", async () => {
      let online = false;
      const send = vi.fn<Transport>(() =>
        Promise.resolve(online ? ok(1) : { kind: "retry", error: "offline" }),
      );
      const { queue } = makeQueue(send, { baseBackoffMs: 9000 });
      queue.enqueue(sample(1));

      const drained = queue.drain(60_000);
      await vi.advanceTimersByTimeAsync(100); // first attempt failed, now waiting ~9 s
      online = true;
      queue.retryNow();
      await vi.advanceTimersByTimeAsync(100);

      expect(await drained).toBe(true);
      expect(Date.now()).toBeLessThan(1000);
    });

    it("resolves immediately when there is nothing to send", async () => {
      const { queue } = makeQueue(vi.fn<Transport>());
      expect(await queue.drain(5000)).toBe(true);
    });
  });

  it("sends a keepalive request with the oldest batch before unload", () => {
    const { transport, calls } = manualTransport();
    const { queue } = makeQueue(transport, { maxBatchSize: 2 });
    for (let t = 1; t <= 3; t++) queue.enqueue(sample(t));

    queue.sendBeforeUnload();

    expect(calls).toEqual([expect.objectContaining({ ts: [1, 2], keepalive: true })]);
  });
});
