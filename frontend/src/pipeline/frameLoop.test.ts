import { describe, expect, it, vi } from "vitest";
import { startFrameLoop, type AnimationScheduler, type FrameSource } from "./frameLoop";

/** Collects scheduled callbacks so the test can fire them one at a time. */
function callbackRegistry<T extends (...args: never[]) => void>() {
  let next = 1;
  const pending = new Map<number, T>();
  return {
    request: (cb: T) => {
      pending.set(next, cb);
      return next++;
    },
    cancel: vi.fn((handle: number) => pending.delete(handle)),
    fireAll: (...args: Parameters<T>) => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb(...args);
    },
    get size() {
      return pending.size;
    },
  };
}

const noRaf: AnimationScheduler = {
  requestAnimationFrame: () => {
    throw new Error("rAF must not be used when rVFC exists");
  },
  cancelAnimationFrame: () => {},
};

describe("startFrameLoop with requestVideoFrameCallback", () => {
  it("calls onFrame once per video frame until stopped", () => {
    const rvfc = callbackRegistry<VideoFrameRequestCallback>();
    const video: FrameSource = {
      currentTime: 0,
      requestVideoFrameCallback: rvfc.request,
      cancelVideoFrameCallback: rvfc.cancel,
    };
    const onFrame = vi.fn();
    const loop = startFrameLoop(video, onFrame, noRaf);
    const metadata = {} as VideoFrameCallbackMetadata;

    rvfc.fireAll(100, metadata);
    rvfc.fireAll(133, metadata);
    loop.stop();
    rvfc.fireAll(166, metadata);

    expect(loop.mode).toBe("rvfc");
    expect(onFrame.mock.calls).toEqual([[100], [133]]);
    expect(rvfc.cancel).toHaveBeenCalled();
    expect(rvfc.size).toBe(0);
  });
});

describe("startFrameLoop with the requestAnimationFrame fallback", () => {
  it("skips display frames where the video hasn't advanced", () => {
    const raf = callbackRegistry<FrameRequestCallback>();
    const video = { currentTime: 0 };
    const onFrame = vi.fn();
    const loop = startFrameLoop(video, onFrame, {
      requestAnimationFrame: raf.request,
      cancelAnimationFrame: raf.cancel,
    });

    video.currentTime = 0.033;
    raf.fireAll(16);
    raf.fireAll(32); // same video frame shown again at 60 Hz
    video.currentTime = 0.066;
    raf.fireAll(48);
    loop.stop();
    video.currentTime = 0.1;
    raf.fireAll(64);

    expect(loop.mode).toBe("raf");
    expect(onFrame.mock.calls).toEqual([[16], [48]]);
  });
});
