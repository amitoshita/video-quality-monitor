import { api as realApi, ApiError, type PublicConfig, type SessionInfo } from "../api/client";
import type { Sample } from "../metrics/types";
import { FrameAnalyzer } from "./analyzer";
import { SecondAggregator } from "./aggregator";
import { CameraError, openCamera } from "./camera";
import { loadFaceDetector, type FaceDetection } from "./faceDetector";
import { startFrameLoop, type FrameLoop } from "./frameLoop";
import { SampleQueue, type QueueStatus, type Transport } from "./sampleQueue";
import { httpTransport } from "./transport";

export type Phase = "idle" | "starting" | "running" | "stopping";

export interface LiveState {
  phase: Phase;
  /** Last problem or notice to show the user, if any. */
  message: { kind: "error" | "info"; text: string } | null;
  sessionId: string | null;
  /** The most recent samples of the current (or last) session, oldest first. */
  recent: Sample[];
  resolution: { width: number; height: number } | null;
  queue: QueueStatus | null;
  hidden: boolean;
  faceDelegate: "GPU" | "CPU" | null;
  frameMode: "rvfc" | "raf" | null;
  /** Samples from earlier sessions that are still being delivered in the background. */
  backgroundPending: number;
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
const STOP_DRAIN_MS = 5000;
const STOP_ATTEMPTS = 3;

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
 */
export class LiveSession {
  private state: LiveState = {
    phase: "idle",
    message: null,
    sessionId: null,
    recent: [],
    resolution: null,
    queue: null,
    hidden: false,
    faceDelegate: null,
    frameMode: null,
    backgroundPending: 0,
  };
  private readonly listeners = new Set<() => void>();
  private running: Running | null = null;
  private readonly background = new Set<SampleQueue>();
  private frameErrorLogged = false;
  private readonly config: PublicConfig;
  private readonly deps: LiveSessionDeps;
  private analyzer: ReturnType<LiveSessionDeps["createAnalyzer"]> | null = null;

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
   * Page-level listeners (pagehide, visibilitychange). Returned function removes them. Kept out
   * of the constructor so React StrictMode's double render can't leak listeners.
   */
  attachToPage(target: Window = window, doc: Document = document): () => void {
    const onPageHide = () => {
      this.flushBeforeUnload();
    };
    const onVisibility = () => {
      this.update({ hidden: doc.visibilityState === "hidden" });
    };
    target.addEventListener("pagehide", onPageHide);
    doc.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      target.removeEventListener("pagehide", onPageHide);
      doc.removeEventListener("visibilitychange", onVisibility);
    };
  }

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.state.phase !== "idle") return;
    this.update({
      phase: "starting",
      message: null,
      sessionId: null,
      recent: [],
      resolution: null,
      queue: null,
    });

    // Start loading the detector (usually already cached) while the permission prompt is open.
    const detectorReady = this.deps.loadFaceDetector();
    detectorReady.catch(() => {}); // handled below; avoids an unhandled rejection if the camera fails first

    let stream: MediaStream | null = null;
    try {
      stream = await this.deps.openCamera();
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();

      const detector = await detectorReady.catch((error: unknown) => {
        console.error("[face] detector failed to load", error);
        throw new Error("Face detection could not be loaded. Reload the page and try again.");
      });
      const session = await this.deps.api.createSession();
      this.begin(session, stream, video, detector);
    } catch (error) {
      console.error("[session] start failed", error);
      stopTracks(stream);
      video.srcObject = null;
      this.update({ phase: "idle", message: { kind: "error", text: describeStartError(error) } });
    }
  }

  private begin(
    session: SessionInfo,
    stream: MediaStream,
    video: HTMLVideoElement,
    detector: FaceDetection,
  ): void {
    const track = stream.getVideoTracks().at(0); // .at() is typed as possibly undefined
    if (!track) throw new CameraError("not_found", "The camera returned no video track.");
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
      sessionId: session.id,
      resolution:
        settings.width && settings.height
          ? { width: settings.width, height: settings.height }
          : null,
      queue: queue.status(),
      faceDelegate: detector.delegate,
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
   * Stops capture immediately (camera light off), sends what's left, then ends the session.
   * The partial last second is dropped. If the queue can't drain within a few seconds, delivery
   * continues in the background and /stop is called once it succeeds.
   */
  async stop(notice: LiveState["message"] = null): Promise<void> {
    const run = this.running;
    if (this.state.phase !== "running" || !run) return;
    this.running = null;
    this.update({ phase: "stopping" });

    run.loop.stop();
    clearInterval(run.ticker);
    run.aggregator.tick(this.deps.now()); // emit seconds that completed; drop the partial one
    run.track.removeEventListener("ended", this.onTrackEnded);
    stopTracks(run.stream);
    run.video.srcObject = null;
    run.queue.stopTimer();

    const drained = await run.queue.drain(STOP_DRAIN_MS);
    run.unsubscribeQueue();
    let message = notice;
    if (drained) {
      await this.endSession(run.session.id);
    } else {
      this.finishInBackground(run.queue, run.session.id);
      message ??= {
        kind: "info",
        text: `${String(run.queue.status().pending)} samples are not delivered yet; still retrying in the background.`,
      };
    }
    this.update({ phase: "idle", queue: run.queue.status(), message });
  }

  private finishInBackground(queue: SampleQueue, sessionId: string): void {
    this.background.add(queue);
    const unsubscribe = queue.subscribe(() => {
      this.updateBackgroundCount();
    });
    this.updateBackgroundCount();
    void (async () => {
      while (!(await queue.drain(60_000))) {
        if (queue.status().pending === 0) break; // closed (session gone)
      }
      unsubscribe();
      this.background.delete(queue);
      this.updateBackgroundCount();
      await this.endSession(sessionId);
    })();
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
