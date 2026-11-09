import { api as realApi, ApiError, type PublicConfig, type SessionInfo } from "../api/client";
import type { Sample } from "../metrics/types";
import { FrameAnalyzer } from "./analyzer";
import { SecondAggregator } from "./aggregator";
import { CameraError, openCamera } from "./camera";
import { loadFaceDetector, type FaceDetection } from "./faceDetector";
import { startFrameLoop, type FrameLoop } from "./frameLoop";
import { SampleQueue, type QueueStatus, type Transport } from "./sampleQueue";
import { httpTransport } from "./transport";

export type Phase = "idle" | "starting" | "running";

/** What Start is waiting for, so the UI can say so instead of showing a frozen button. */
export type StartStep = "camera" | "detector" | "session";

export interface DetectorState {
  status: "idle" | "loading" | "ready" | "failed";
  delegate: "GPU" | "CPU" | null;
  error: string | null;
}

export interface LiveState {
  phase: Phase;
  startStep: StartStep | null;
  /** Last problem or notice to show the user, if any. */
  message: { kind: "error" | "info"; text: string } | null;
  sessionId: string | null;
  /** The most recent samples of the current (or last) session, oldest first. */
  recent: Sample[];
  resolution: { width: number; height: number } | null;
  /** Delivery status of the running session's queue. */
  queue: QueueStatus | null;
  hidden: boolean;
  detector: DetectorState;
  frameMode: "rvfc" | "raf" | null;
  /** Samples of stopped sessions that are still being delivered in the background. */
  backgroundPending: number;
  /** Increments each time a stopped session is fully delivered, so views of stored data refresh. */
  deliveredSessions: number;
}

/** What the controller needs from the outside world; injected so it can be tested. */
export interface LiveSessionDeps {
  api: Pick<typeof realApi, "createSession" | "stopSession">;
  openCamera: () => Promise<MediaStream>;
  loadFaceDetector: () => Promise<FaceDetection>;
  createAnalyzer: () => Pick<FrameAnalyzer, "reset" | "process" | "brightness" | "motion">;
  transportFor: (sessionId: string) => Transport;
  now: () => number;
}

export const RECENT_SECONDS = 30;
const TICK_MS = 250;
const STOP_ATTEMPTS = 3;
const DETECTOR_ERROR =
  "Face detection could not be loaded, so quality can't be measured honestly. " +
  "Check your connection and press Start to try again, or reload the page.";

interface Running {
  session: SessionInfo;
  stream: MediaStream;
  track: MediaStreamTrack;
  video: HTMLVideoElement;
  detector: FaceDetection;
  queue: SampleQueue;
  aggregator: SecondAggregator;
  loop: FrameLoop;
  ticker: ReturnType<typeof setInterval>;
  unsubscribeQueue: () => void;
}

/**
 * Owns one live session at a time: camera → frame loop → metrics → per-second samples → queue.
 * Plain TypeScript outside React; the UI subscribes to state snapshots.
 *
 * Start order: camera first, then the backend session. A denied permission therefore never
 * leaves an empty session behind; if creating the session fails, the camera is released.
 *
 * Every backend session gets its own SampleQueue bound to its id, so samples of different
 * sessions can never mix. Stop releases the camera and returns to idle at once; the stopped
 * session's queue finishes delivering (then calls /stop) in the background, so a new Start is
 * never blocked by a slow network.
 */
export class LiveSession {
  private state: LiveState = {
    phase: "idle",
    startStep: null,
    message: null,
    sessionId: null,
    recent: [],
    resolution: null,
    queue: null,
    hidden: false,
    detector: { status: "idle", delegate: null, error: null },
    frameMode: null,
    backgroundPending: 0,
    deliveredSessions: 0,
  };
  private readonly listeners = new Set<() => void>();
  private running: Running | null = null;
  private readonly background = new Set<SampleQueue>();
  private frameErrorLogged = false;
  private readonly config: PublicConfig;
  private readonly deps: LiveSessionDeps;
  private analyzer: ReturnType<LiveSessionDeps["createAnalyzer"]> | null = null;
  private detectorLoad: Promise<FaceDetection> | null = null;
  /** Bumped by every start() and by stop() during a start; a stale start sees the mismatch. */
  private startToken = 0;

  constructor(config: PublicConfig, deps: Partial<LiveSessionDeps> = {}) {
    this.config = config;
    this.deps = {
      api: realApi,
      openCamera,
      loadFaceDetector,
      createAnalyzer: () => new FrameAnalyzer(),
      transportFor: httpTransport,
      now: () => performance.now(),
      ...deps,
    };
  }

  getState = (): LiveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Page-level listeners (pagehide, visibilitychange, online). Returned function removes them. Kept out
   * of the constructor so React StrictMode's double render can't leak listeners.
   */
  attachToPage(target: Window = window, doc: Document = document): () => void {
    const onPageHide = () => {
      this.flushBeforeUnload();
    };
    const onVisibility = () => {
      this.update({ hidden: doc.visibilityState === "hidden" });
    };
    const onOnline = () => {
      this.running?.queue.retryNow();
      for (const queue of this.background) queue.retryNow();
    };
    target.addEventListener("pagehide", onPageHide);
    target.addEventListener("online", onOnline);
    doc.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      target.removeEventListener("pagehide", onPageHide);
      target.removeEventListener("online", onOnline);
      doc.removeEventListener("visibilitychange", onVisibility);
    };
  }

  /**
   * Starts loading the face detector (wasm + model) in the background, so Start is instant.
   * Called on page load; safe to call again. A failed load can be retried.
   */
  preloadFaceDetector(): void {
    this.loadDetector().catch(() => {}); // the failure is reported through state
  }

  private loadDetector(): Promise<FaceDetection> {
    if (this.detectorLoad) return this.detectorLoad;
    this.update({ detector: { status: "loading", delegate: null, error: null } });
    const load = this.deps.loadFaceDetector().then(
      (detector) => {
        this.update({ detector: { status: "ready", delegate: detector.delegate, error: null } });
        return detector;
      },
      (error: unknown) => {
        console.error("[face] detector failed to load", error);
        this.detectorLoad = null; // the next Start retries
        this.update({ detector: { status: "failed", delegate: null, error: DETECTOR_ERROR } });
        throw new Error(DETECTOR_ERROR);
      },
    );
    this.detectorLoad = load;
    return load;
  }

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.state.phase !== "idle") return;
    const token = ++this.startToken;
    this.update({
      phase: "starting",
      startStep: "camera",
      message: null,
      sessionId: null,
      recent: [],
      resolution: null,
      queue: null,
    });

    // Usually already loaded by preloadFaceDetector(); keeps loading during the permission prompt.
    const detectorReady = this.loadDetector();
    detectorReady.catch(() => {}); // awaited below; avoids an unhandled rejection if the camera fails first

    let stream: MediaStream | null = null;
    // stop() during a start cancels it: every await below may resume after that.
    const cancelled = () => token !== this.startToken;
    const release = () => {
      stopTracks(stream);
      if (video.srcObject === stream) video.srcObject = null;
    };
    try {
      stream = await this.deps.openCamera();
      if (cancelled()) {
        release();
        return;
      }
      // .at() is typed as possibly undefined. Checked before the backend session exists, so a
      // broken camera never leaves an empty session behind.
      const track = stream.getVideoTracks().at(0);
      if (!track) throw new CameraError("not_found", "The camera returned no video track.");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (cancelled()) {
        release();
        return;
      }

      // Without a detector there is no honest "face" value, so no session is started at all.
      if (this.state.detector.status !== "ready") this.update({ startStep: "detector" });
      const detector = await detectorReady;
      if (cancelled()) {
        release();
        return;
      }

      this.update({ startStep: "session" });
      const session = await this.deps.api.createSession();
      if (cancelled()) {
        release();
        void this.endSession(session.id); // created just as Start was cancelled: end it, empty
        return;
      }
      this.begin(session, stream, track, video, detector);
    } catch (error) {
      release();
      if (cancelled()) return; // nobody is waiting for this start any more
      console.error("[session] start failed", error);
      this.update({
        phase: "idle",
        startStep: null,
        message: { kind: "error", text: describeStartError(error) },
      });
    }
  }

  private begin(
    session: SessionInfo,
    stream: MediaStream,
    track: MediaStreamTrack,
    video: HTMLVideoElement,
    detector: FaceDetection,
  ): void {
    const settings = track.getSettings();

    this.analyzer ??= this.deps.createAnalyzer();
    const analyzer = this.analyzer;
    analyzer.reset(); // never diff against a frame from the previous session

    const queue = new SampleQueue(this.deps.transportFor(session.id), {
      maxBatchSize: this.config.maxBatchSize,
    });
    const unsubscribeQueue = queue.subscribe(() => {
      this.update({ queue: queue.status() });
    });
    queue.start();

    const startMs = this.deps.now();
    const aggregator = new SecondAggregator(startMs, this.config.thresholds, (sample) => {
      queue.enqueue(sample);
      this.update({ recent: [...this.state.recent, sample].slice(-RECENT_SECONDS) });
    });

    const onFrame = (nowMs: number) => {
      try {
        analyzer.process(video, nowMs);
        const face = detector.hasFace(video, nowMs);
        aggregator.addFrame(nowMs, analyzer.brightness, analyzer.motion, face);
      } catch (error) {
        // A frame that can't be analysed is not counted: FPS stays honest.
        if (!this.frameErrorLogged) console.error("[frame] analysis failed", error);
        this.frameErrorLogged = true;
      }
    };

    const ticker = setInterval(() => {
      aggregator.tick(this.deps.now());
    }, TICK_MS);
    const loop = startFrameLoop(video, onFrame);
    track.addEventListener("ended", this.onTrackEnded);

    this.running = {
      session,
      stream,
      track,
      video,
      detector,
      queue,
      aggregator,
      loop,
      ticker,
      unsubscribeQueue,
    };
    this.update({
      phase: "running",
      startStep: null,
      sessionId: session.id,
      resolution:
        settings.width && settings.height
          ? { width: settings.width, height: settings.height }
          : null,
      queue: queue.status(),
      frameMode: loop.mode,
    });
  }

  private readonly onTrackEnded = () => {
    void this.stop({
      kind: "error",
      text: "The camera was disconnected or access was revoked, so the session was stopped.",
    });
  };

  /**
   * Stops capture at once (camera light off) and returns to idle, so Start is available again
   * immediately. Seconds that completed are emitted; the partial last second is dropped.
   * Called while a start is still in progress, it cancels that start instead.
   *
   * The returned promise settles when the stopped session has finished in the background: its
   * queue delivered everything (retrying through network errors), then /stop was called.
   */
  stop(notice: LiveState["message"] = null): Promise<void> {
    if (this.state.phase === "starting") {
      // Cancel the pending start; it releases the camera itself when its current step returns.
      this.startToken += 1;
      this.update({ phase: "idle", startStep: null, message: notice });
      return Promise.resolve();
    }
    const run = this.running;
    if (this.state.phase !== "running" || !run) return Promise.resolve();
    this.running = null;

    run.loop.stop();
    clearInterval(run.ticker);
    run.aggregator.tick(this.deps.now()); // emit seconds that completed; drop the partial one
    run.track.removeEventListener("ended", this.onTrackEnded);
    stopTracks(run.stream);
    run.video.srcObject = null;
    run.queue.stopTimer();
    run.unsubscribeQueue();

    this.update({ phase: "idle", queue: null, message: notice });
    return this.finishInBackground(run.queue, run.session.id);
  }

  /** Delivers a stopped session's remaining samples, then ends it on the backend. */
  private async finishInBackground(queue: SampleQueue, sessionId: string): Promise<void> {
    this.background.add(queue);
    const unsubscribe = queue.subscribe(() => {
      this.updateBackgroundCount();
    });
    this.updateBackgroundCount();
    try {
      // drain() honours the queue's backoff; it returns early only when the queue is empty or
      // closed (session gone), otherwise we simply keep going until the page is closed.
      while (!(await queue.drain(60_000)) && queue.status().pending > 0) {
        /* keep retrying */
      }
    } finally {
      unsubscribe();
      this.background.delete(queue);
      this.updateBackgroundCount();
    }
    await this.endSession(sessionId);
    this.update({ deliveredSessions: this.state.deliveredSessions + 1 });
  }

  /** /stop is idempotent, so retrying it after a network error is safe. */
  private async endSession(sessionId: string): Promise<void> {
    for (let attempt = 1; attempt <= STOP_ATTEMPTS; attempt++) {
      try {
        await this.deps.api.stopSession(sessionId);
        return;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return;
        if (attempt < STOP_ATTEMPTS) await sleep(1000 * attempt);
      }
    }
    // Not fatal: like closing the tab, the session simply ends at its last sample.
    console.warn("[session] /stop failed; the session ends at its last sample");
  }

  /**
   * pagehide: fire the pending samples with fetch keepalive. /stop is deliberately not sent:
   * parallel keepalive requests are unordered, and a /stop that lands first would make the
   * samples arrive "after stop" and be ignored. The session then ends at its last sample.
   */
  private flushBeforeUnload(): void {
    this.running?.queue.sendBeforeUnload();
    for (const queue of this.background) queue.sendBeforeUnload();
  }

  private updateBackgroundCount(): void {
    let pending = 0;
    for (const queue of this.background) pending += queue.status().pending;
    this.update({ backgroundPending: pending });
  }

  private update(patch: Partial<LiveState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function stopTracks(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function describeStartError(error: unknown): string {
  if (error instanceof CameraError) return error.message;
  if (error instanceof ApiError) return `The server could not start a session: ${error.message}`;
  if (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "TimeoutError")
  ) {
    return "Can't reach the server. Check your connection and press Start again.";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "The browser blocked video playback. Press Start again.";
  }
  return error instanceof Error ? error.message : "Something went wrong. Press Start again.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
