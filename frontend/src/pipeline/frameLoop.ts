/** The parts of a <video> element the loop needs (narrowed so tests can fake it). */
export interface FrameSource {
  readonly currentTime: number;
  requestVideoFrameCallback?: HTMLVideoElement["requestVideoFrameCallback"];
  cancelVideoFrameCallback?: HTMLVideoElement["cancelVideoFrameCallback"];
}

export interface AnimationScheduler {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

export interface FrameLoop {
  readonly mode: "rvfc" | "raf";
  stop(): void;
}

/**
 * Calls onFrame(nowMs) once per *new* video frame.
 *
 * requestVideoFrameCallback fires once per decoded frame, so the FPS we count is real. Where it
 * is missing we fall back to requestAnimationFrame (display rate) and skip ticks where the
 * video's currentTime hasn't moved, so a repeated frame is never counted twice.
 */
export function startFrameLoop(
  video: FrameSource,
  onFrame: (nowMs: number) => void,
  scheduler?: AnimationScheduler,
): FrameLoop {
  let stopped = false;
  const { requestVideoFrameCallback, cancelVideoFrameCallback } = video;

  if (requestVideoFrameCallback && cancelVideoFrameCallback) {
    let handle = 0;
    const onVideoFrame: VideoFrameRequestCallback = (now) => {
      if (stopped) return;
      handle = requestVideoFrameCallback.call(video, onVideoFrame);
      onFrame(now);
    };
    handle = requestVideoFrameCallback.call(video, onVideoFrame);
    return {
      mode: "rvfc",
      stop() {
        stopped = true;
        cancelVideoFrameCallback.call(video, handle);
      },
    };
  }

  const raf = scheduler ?? window; // resolved only when the fallback is actually needed
  let handle = 0;
  let lastMediaTime = -1;
  const onAnimationFrame: FrameRequestCallback = (now) => {
    if (stopped) return;
    handle = raf.requestAnimationFrame(onAnimationFrame);
    if (video.currentTime === lastMediaTime) return;
    lastMediaTime = video.currentTime;
    onFrame(now);
  };
  handle = raf.requestAnimationFrame(onAnimationFrame);
  return {
    mode: "raf",
    stop() {
      stopped = true;
      raf.cancelAnimationFrame(handle);
    },
  };
}
