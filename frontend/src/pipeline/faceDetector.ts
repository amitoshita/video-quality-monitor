import type { FaceDetector } from "@mediapipe/tasks-vision";

export interface FaceDetection {
  readonly delegate: "GPU" | "CPU";
  /** True if at least one face is in the frame. */
  hasFace(video: HTMLVideoElement, nowMs: number): boolean;
}

let shared: Promise<FaceDetection> | null = null;

/**
 * Loads MediaPipe's BlazeFace short-range detector once per page and reuses it across sessions
 * (re-creating it would leak WebGL contexts). Model and wasm are served from our own origin.
 * Tries the GPU delegate first and falls back to CPU.
 */
export function loadFaceDetector(): Promise<FaceDetection> {
  shared ??= createFaceDetection().catch((error: unknown) => {
    shared = null; // allow a retry on the next Start
    throw error;
  });
  return shared;
}

async function createFaceDetection(): Promise<FaceDetection> {
  // Separate chunk: the app shell renders without waiting for MediaPipe.
  const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const assetUrl = (path: string) => new URL(import.meta.env.BASE_URL + path, location.href).href;
  const fileset = await FilesetResolver.forVisionTasks(assetUrl("mediapipe/wasm"));

  let lastError: unknown = null;
  for (const delegate of ["GPU", "CPU"] as const) {
    try {
      const detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: assetUrl("models/blaze_face_short_range.tflite"),
          delegate,
        },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
      });
      return wrap(detector, delegate);
    } catch (error) {
      lastError = error;
      console.warn(`[face] ${delegate} delegate unavailable`, error);
    }
  }
  throw lastError;
}

function wrap(detector: FaceDetector, delegate: "GPU" | "CPU"): FaceDetection {
  let lastTimestamp = Number.NEGATIVE_INFINITY;
  return {
    delegate,
    hasFace(video, nowMs) {
      // VIDEO mode requires strictly increasing timestamps, also across sessions.
      const timestamp = nowMs > lastTimestamp ? nowMs : lastTimestamp + 1;
      lastTimestamp = timestamp;
      return detector.detectForVideo(video, timestamp).detections.length > 0;
    },
  };
}
