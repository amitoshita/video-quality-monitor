import {
  ANALYSIS_HEIGHT,
  ANALYSIS_PIXELS,
  ANALYSIS_WIDTH,
  computeLuma,
  meanMotion,
} from "../metrics/luma";

/**
 * Longest gap between two processed frames that is still diffed for motion. After a longer
 * gap (hidden tab, stalled camera) the "previous" frame is stale and the diff would report
 * movement that never happened.
 */
export const MAX_MOTION_GAP_MS = 1000;

/**
 * Downscales a frame to 160×120 and measures brightness and motion.
 *
 * The two luma buffers are allocated once and swapped each frame. getImageData itself still
 * returns a fresh ImageData every call; the 2D canvas API has no way to read into an existing
 * buffer.
 */
export class FrameAnalyzer {
  /** Results of the last process() call (fields instead of a returned object: no allocation). */
  brightness = 0;
  motion: number | null = null;

  private readonly context: CanvasRenderingContext2D;
  private current = new Uint8Array(ANALYSIS_PIXELS);
  private previous = new Uint8Array(ANALYSIS_PIXELS);
  private hasPrevious = false;
  private lastFrameAt = Number.NEGATIVE_INFINITY;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = ANALYSIS_WIDTH;
    canvas.height = ANALYSIS_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
    if (!context) throw new Error("2D canvas is not available");
    this.context = context;
  }

  /** Forget the previous frame, so a new session never diffs against an old one. */
  reset(): void {
    this.hasPrevious = false;
    this.lastFrameAt = Number.NEGATIVE_INFINITY;
  }

  /** Analyses the unmirrored video frame (the preview's mirroring is CSS only). */
  process(source: CanvasImageSource, nowMs: number): void {
    this.context.drawImage(source, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const { data } = this.context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    this.brightness = computeLuma(data, this.current);

    const contiguous = this.hasPrevious && nowMs - this.lastFrameAt <= MAX_MOTION_GAP_MS;
    this.motion = contiguous ? meanMotion(this.current, this.previous) : null;

    [this.current, this.previous] = [this.previous, this.current];
    this.hasPrevious = true;
    this.lastFrameAt = nowMs;
  }
}
