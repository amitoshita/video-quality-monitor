import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type PublicConfig, type SessionInfo } from "../api/client";
import { CameraError } from "./camera";
import type { SendOutcome, Transport } from "./sampleQueue";
import { LiveSession, type LiveSessionDeps } from "./session";

const config: PublicConfig = {
  thresholds: { minFps: 15, minBrightness: 60, maxBrightness: 200, maxMotion: 20 },
  maxBatchSize: 120,
};

const SESSION: SessionInfo = { id: "s-1", started_at: "2026-11-08T10:00:00Z", ended_at: null };

function fakeTrack() {
  const listeners = new Map<string, () => void>();
  return {
    stop: vi.fn(),
    getSettings: () => ({ width: 640, height: 480 }),
    addEventListener: vi.fn((type: string, fn: () => void) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    fire: (type: string) => listeners.get(type)?.(),
  };
}

function fakeStream(track = fakeTrack()) {
  return {
    track,
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
  };
}

/** A <video> whose requestVideoFrameCallback the test fires by hand. */
function fakeVideo() {
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  let nextHandle = 1;
  const video = {
    srcObject: null as MediaStream | null,
    muted: false,
    playsInline: false,
    currentTime: 0,
    play: vi.fn(() => Promise.resolve()),
    requestVideoFrameCallback: (cb: VideoFrameRequestCallback) => {
      callbacks.set(nextHandle, cb);
      return nextHandle++;
    },
    cancelVideoFrameCallback: (handle: number) => callbacks.delete(handle),
  };
  return {
    video,
    element: video as unknown as HTMLVideoElement,
    pendingCallbacks: () => callbacks.size,
    /** Delivers one decoded frame at the current (fake) time. */
    frame: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const cb of pending) cb(Date.now(), {} as VideoFrameCallbackMetadata);
    },
  };
}

function setup(overrides: Partial<LiveSessionDeps> = {}) {
  const { stream, track } = fakeStream();
  const sent: { ts: number[]; keepalive: boolean }[] = [];
  let respond: (samples: readonly unknown[]) => SendOutcome = (samples) => ({
    kind: "ok",
    result: { accepted: samples.length, duplicates: 0, ignored_after_stop: 0 },
  });
  const transport: Transport = (samples, keepalive) => {
    sent.push({ ts: samples.map((s) => s.t), keepalive });
    return Promise.resolve(respond(samples));
  };
  const calls: string[] = [];
  const analyzer = {
    brightness: 120,
    motion: 2 as number | null,
    reset: vi.fn(),
    process: vi.fn(),
  };
  const deps: LiveSessionDeps = {
    api: {
      createSession: vi.fn(() => {
        calls.push("createSession");
        return Promise.resolve(SESSION);
      }),
      stopSession: vi.fn(() => {
        calls.push("stopSession");
        return Promise.resolve({ ...SESSION, ended_at: "2026-11-08T10:01:00Z" });
      }),
    },
    openCamera: vi.fn(() => {
      calls.push("openCamera");
      return Promise.resolve(stream);
    }),
    loadFaceDetector: () => Promise.resolve({ delegate: "CPU", hasFace: () => true }),
    createAnalyzer: () => analyzer,
    transportFor: () => transport,
    now: () => Date.now(),
    ...overrides,
  };
  const live = new LiveSession(config, deps);
  const v = fakeVideo();
  return {
    live,
    deps,
    track,
    stream,
    sent,
    calls,
    analyzer,
    ...v,
    setResponse: (fn: typeof respond) => {
      respond = fn;
    },
  };
}

/** Plays `seconds` of video at 30 fps, advancing the fake clock and timers. */
async function play(ctx: ReturnType<typeof setup>, seconds: number) {
  for (let i = 0; i < seconds * 30; i++) {
    await vi.advanceTimersByTimeAsync(1000 / 30);
    ctx.frame();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LiveSession start", () => {
  it("opens the camera before creating the backend session", async () => {
    const ctx = setup();

    await ctx.live.start(ctx.element);

    expect(ctx.calls).toEqual(["openCamera", "createSession"]);
    expect(ctx.live.getState()).toMatchObject({
      phase: "running",
      sessionId: "s-1",
      resolution: { width: 640, height: 480 },
      frameMode: "rvfc",
      detector: { status: "ready", delegate: "CPU", error: null },
    });
    expect(ctx.video.srcObject).toBe(ctx.stream);
    expect(ctx.video.muted).toBe(true);
  });

  it("creates no session when camera permission is denied", async () => {
    const ctx = setup({
      openCamera: () => Promise.reject(new CameraError("denied", "Camera access is blocked.")),
    });

    await ctx.live.start(ctx.element);

    expect(ctx.deps.api.createSession).not.toHaveBeenCalled();
    expect(ctx.live.getState()).toMatchObject({
      phase: "idle",
      message: { kind: "error", text: "Camera access is blocked." },
    });
  });

  it("releases the camera when the session can't be created", async () => {
    const ctx = setup({
      api: {
        createSession: () => Promise.reject(new TypeError("Failed to fetch")),
        stopSession: vi.fn(),
      },
    });

    await ctx.live.start(ctx.element);

    expect(ctx.track.stop).toHaveBeenCalled();
    expect(ctx.video.srcObject).toBeNull();
    expect(ctx.live.getState().phase).toBe("idle");
    expect(ctx.live.getState().message?.text).toMatch(/Can't reach the server/);
  });

  it("explains a server error when creating the session", async () => {
    const ctx = setup({
      api: {
        createSession: () => Promise.reject(new ApiError(500, "internal_error", "Internal")),
        stopSession: vi.fn(),
      },
    });

    await ctx.live.start(ctx.element);

    expect(ctx.live.getState().message?.text).toBe(
      "The server could not start a session: Internal",
    );
  });
});

describe("LiveSession while running", () => {
  it("emits one sample per second and sends them in batches", async () => {
    const ctx = setup();
    await ctx.live.start(ctx.element);

    await play(ctx, 3.2);

    expect(ctx.live.getState().recent.map((s) => s.t)).toEqual([1, 2, 3]);
    expect(ctx.live.getState().recent[0]).toMatchObject({ fps: 30, verdict: "good" });
    expect(ctx.sent.flatMap((c) => c.ts)).toEqual([1, 2]); // flushes at 1.5 s and 3 s
  });

  it("stops by itself when the camera track ends", async () => {
    const ctx = setup();
    await ctx.live.start(ctx.element);
    await play(ctx, 1.1);

    ctx.track.fire("ended");
    await vi.advanceTimersByTimeAsync(10);

    expect(ctx.live.getState()).toMatchObject({ phase: "idle" });
    expect(ctx.live.getState().message?.text).toMatch(/disconnected/);
    expect(ctx.deps.api.stopSession).toHaveBeenCalled();
  });
});

describe("LiveSession stop", () => {
  it("releases the camera, sends the remaining samples, then ends the session", async () => {
    const ctx = setup();
    await ctx.live.start(ctx.element);
    await play(ctx, 2.5);

    await ctx.live.stop();

    expect(ctx.track.stop).toHaveBeenCalled();
    expect(ctx.video.srcObject).toBeNull();
    expect(ctx.pendingCallbacks()).toBe(0);
    // Seconds 1 and 2 delivered; the partial third second is dropped.
    expect(ctx.sent.flatMap((c) => c.ts)).toEqual([1, 2]);
    expect(ctx.calls.at(-1)).toBe("stopSession");
    expect(ctx.live.getState().phase).toBe("idle");
  });

  it("is a no-op when nothing is running, and when called twice", async () => {
    const ctx = setup();
    await ctx.live.stop();
    await ctx.live.start(ctx.element);

    await Promise.all([ctx.live.stop(), ctx.live.stop()]);

    expect(ctx.deps.api.stopSession).toHaveBeenCalledTimes(1);
  });

  it("supports Start → Stop → Start without duplicate frame loops or stale frames", async () => {
    const ctx = setup();
    for (let round = 0; round < 3; round++) {
      await ctx.live.start(ctx.element);
      expect(ctx.pendingCallbacks()).toBe(1);
      await play(ctx, 1.2);
      await ctx.live.stop();
      expect(ctx.pendingCallbacks()).toBe(0);
    }
    expect(ctx.analyzer.reset).toHaveBeenCalledTimes(3);
    expect(ctx.deps.api.stopSession).toHaveBeenCalledTimes(3);
  });

  it("returns to idle at once and keeps delivering in the background when offline", async () => {
    const ctx = setup();
    ctx.setResponse(() => ({ kind: "retry", error: "offline" }));
    await ctx.live.start(ctx.element);
    await play(ctx, 2.1);

    const finished = ctx.live.stop();

    expect(ctx.live.getState()).toMatchObject({ phase: "idle", backgroundPending: 2 });
    expect(ctx.track.stop).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);
    expect(ctx.deps.api.stopSession).not.toHaveBeenCalled();

    ctx.setResponse((samples) => ({
      kind: "ok",
      result: { accepted: samples.length, duplicates: 0, ignored_after_stop: 0 },
    }));
    await vi.advanceTimersByTimeAsync(40_000);
    await finished;

    expect(ctx.live.getState().backgroundPending).toBe(0);
    expect(ctx.deps.api.stopSession).toHaveBeenCalledTimes(1);
  });

  it("retries /stop after a network error", async () => {
    const stopSession = vi
      .fn<LiveSessionDeps["api"]["stopSession"]>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(SESSION);
    const ctx = setup({ api: { createSession: () => Promise.resolve(SESSION), stopSession } });
    await ctx.live.start(ctx.element);

    const stopping = ctx.live.stop();
    await vi.advanceTimersByTimeAsync(2000);
    await stopping;

    expect(stopSession).toHaveBeenCalledTimes(2);
  });
});

describe("LiveSession page lifecycle", () => {
  it("sends pending samples with keepalive on pagehide, without calling /stop", async () => {
    const ctx = setup();
    const page = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const detach = ctx.live.attachToPage(page as unknown as Window, doc as unknown as Document);
    await ctx.live.start(ctx.element);
    await play(ctx, 1.2); // second 1 queued, not yet flushed

    page.dispatchEvent(new Event("pagehide"));

    expect(ctx.sent).toEqual([{ ts: [1], keepalive: true }]);
    expect(ctx.deps.api.stopSession).not.toHaveBeenCalled();
    detach();
  });

  it("retries immediately when the browser comes back online", async () => {
    const ctx = setup();
    const page = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    ctx.live.attachToPage(page as unknown as Window, doc as unknown as Document);
    ctx.setResponse(() => ({ kind: "retry", error: "offline" }));
    await ctx.live.start(ctx.element);
    await play(ctx, 8); // several failures: backoff is now several seconds long
    const attemptsBefore = ctx.sent.length;
    expect(ctx.live.getState().queue?.retryAt).not.toBeNull();

    ctx.setResponse((samples) => ({
      kind: "ok",
      result: { accepted: samples.length, duplicates: 0, ignored_after_stop: 0 },
    }));
    page.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.sent.length).toBe(attemptsBefore + 1);
    expect(ctx.live.getState().queue).toMatchObject({ failures: 0, retryAt: null });
  });

  it("reflects tab visibility in the state", () => {
    const ctx = setup();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    ctx.live.attachToPage(new EventTarget() as unknown as Window, doc as unknown as Document);

    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));

    expect(ctx.live.getState().hidden).toBe(true);
  });
});

describe("LiveSession with a previous session still sending", () => {
  it("starts a new session at once and never mixes samples between sessions", async () => {
    const ids = ["s-1", "s-2"];
    const online = { "s-1": false, "s-2": true } as Record<string, boolean>;
    const sentTo: Record<string, { t: number; brightness: number | null }[][]> = {
      "s-1": [],
      "s-2": [],
    };
    const createSession = vi.fn(() =>
      Promise.resolve({ ...SESSION, id: ids.shift() ?? "unexpected" }),
    );
    const stopSession = vi.fn((id: string) => Promise.resolve({ ...SESSION, id }));
    const ctx = setup({
      api: { createSession, stopSession },
      transportFor: (id) => (samples) => {
        sentTo[id].push(samples.map(({ t, brightness }) => ({ t, brightness })));
        return Promise.resolve(
          online[id]
            ? {
                kind: "ok",
                result: { accepted: samples.length, duplicates: 0, ignored_after_stop: 0 },
              }
            : { kind: "retry", error: "offline" },
        );
      },
    });

    // Session 1 (brightness 50) records 2 s while its backend requests fail.
    ctx.analyzer.brightness = 50;
    await ctx.live.start(ctx.element);
    await play(ctx, 2.1);
    const firstFinished = ctx.live.stop();

    // Start again right away: not blocked by session 1's pending samples.
    ctx.analyzer.brightness = 150;
    await ctx.live.start(ctx.element);
    expect(ctx.live.getState()).toMatchObject({
      phase: "running",
      sessionId: "s-2",
      backgroundPending: 2,
    });
    await play(ctx, 3.2);

    // Session 1's network recovers while session 2 is still running.
    online["s-1"] = true;
    await vi.advanceTimersByTimeAsync(40_000);
    await firstFinished;

    // Seconds with frames carry their session's brightness; session 2 also emitted honest
    // fps:0 seconds (brightness null) while the clock ran on without frames.
    const brightnessSentTo = (id: string) =>
      new Set(
        sentTo[id]
          .flat()
          .map((sample) => sample.brightness)
          .filter((b) => b !== null),
      );
    expect(brightnessSentTo("s-1")).toEqual(new Set([50]));
    expect(brightnessSentTo("s-2")).toEqual(new Set([150]));
    expect(stopSession.mock.calls).toEqual([["s-1"]]); // session 2 is still running
    expect(ctx.live.getState()).toMatchObject({ backgroundPending: 0, sessionId: "s-2" });
  });
});

describe("LiveSession face detector loading", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("preloads in the background and reports when it is ready", async () => {
    const load = deferred<{ delegate: "GPU"; hasFace: () => boolean }>();
    const loadFaceDetector = vi.fn(() => load.promise);
    const ctx = setup({ loadFaceDetector });

    ctx.live.preloadFaceDetector();
    expect(ctx.live.getState().detector.status).toBe("loading");
    load.resolve({ delegate: "GPU", hasFace: () => true });
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.live.getState().detector).toEqual({ status: "ready", delegate: "GPU", error: null });
    await ctx.live.start(ctx.element);
    expect(loadFaceDetector).toHaveBeenCalledTimes(1); // Start reuses the preloaded detector
  });

  it("says it is waiting for the detector when Start is pressed before it is ready", async () => {
    const load = deferred<{ delegate: "CPU"; hasFace: () => boolean }>();
    const ctx = setup({ loadFaceDetector: () => load.promise });

    const starting = ctx.live.start(ctx.element);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.live.getState()).toMatchObject({ phase: "starting", startStep: "detector" });
    expect(ctx.deps.api.createSession).not.toHaveBeenCalled();

    load.resolve({ delegate: "CPU", hasFace: () => true });
    await starting;
    expect(ctx.live.getState()).toMatchObject({ phase: "running", startStep: null });
  });

  it("refuses to start without a detector instead of reporting 'no face'", async () => {
    const loadFaceDetector = vi
      .fn<LiveSessionDeps["loadFaceDetector"]>()
      .mockRejectedValueOnce(new Error("wasm 404"))
      .mockResolvedValue({ delegate: "CPU", hasFace: () => true });
    const ctx = setup({ loadFaceDetector });

    ctx.live.preloadFaceDetector();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.live.getState().detector.status).toBe("failed");

    // The first Start retries the load (which succeeds this time).
    await ctx.live.start(ctx.element);
    expect(loadFaceDetector).toHaveBeenCalledTimes(2);
    expect(ctx.live.getState().phase).toBe("running");
  });

  it("releases the camera and creates no session if the detector fails during Start", async () => {
    const ctx = setup({ loadFaceDetector: () => Promise.reject(new Error("model 404")) });

    await ctx.live.start(ctx.element);

    expect(ctx.deps.api.createSession).not.toHaveBeenCalled();
    expect(ctx.track.stop).toHaveBeenCalled();
    expect(ctx.live.getState()).toMatchObject({
      phase: "idle",
      recent: [],
      detector: { status: "failed" },
      message: { kind: "error" },
    });
    expect(ctx.live.getState().message?.text).toMatch(/Face detection could not be loaded/);
  });
});

describe("LiveSession stop during start", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it("cancels while the permission prompt is open and releases the camera when it resolves", async () => {
    const camera = deferred<MediaStream>();
    const ctx = setup({ openCamera: () => camera.promise });

    const starting = ctx.live.start(ctx.element);
    await vi.advanceTimersByTimeAsync(0);
    void ctx.live.stop({ kind: "info", text: "stopped" });

    expect(ctx.live.getState()).toMatchObject({ phase: "idle", startStep: null });
    camera.resolve(ctx.stream); // the user answers the prompt after leaving
    await starting;

    expect(ctx.track.stop).toHaveBeenCalled();
    expect(ctx.video.srcObject).toBeNull();
    expect(ctx.deps.api.createSession).not.toHaveBeenCalled();
    expect(ctx.live.getState().phase).toBe("idle");
  });

  it("ends a session that was created just as the start was cancelled", async () => {
    const created = deferred<SessionInfo>();
    const ctx = setup({
      api: {
        createSession: () => created.promise,
        stopSession: vi.fn(() => Promise.resolve(SESSION)),
      },
    });

    const starting = ctx.live.start(ctx.element);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.live.getState().startStep).toBe("session");
    void ctx.live.stop();
    created.resolve(SESSION);
    await starting;
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.deps.api.stopSession).toHaveBeenCalledWith("s-1");
    expect(ctx.track.stop).toHaveBeenCalled();
    expect(ctx.pendingCallbacks()).toBe(0); // no frame loop was started
    expect(ctx.live.getState().phase).toBe("idle");
  });

  it("a cancelled start that resumes late doesn't disturb a newer session", async () => {
    const firstCamera = deferred<MediaStream>();
    const stale = fakeStream();
    const fresh = fakeStream();
    const openCamera = vi
      .fn<() => Promise<MediaStream>>()
      .mockReturnValueOnce(firstCamera.promise)
      .mockResolvedValueOnce(fresh.stream);
    const ctx = setup({ openCamera });

    const firstStart = ctx.live.start(ctx.element);
    await vi.advanceTimersByTimeAsync(0);
    void ctx.live.stop();
    await ctx.live.start(ctx.element); // second start succeeds
    expect(ctx.live.getState().phase).toBe("running");

    firstCamera.resolve(stale.stream); // the first prompt resolves only now
    await firstStart;

    expect(stale.track.stop).toHaveBeenCalled(); // its own camera is released
    expect(fresh.track.stop).not.toHaveBeenCalled(); // the running session is untouched
    expect(ctx.video.srcObject).toBe(fresh.stream);
    expect(ctx.live.getState()).toMatchObject({ phase: "running", sessionId: "s-1" });
  });
});
