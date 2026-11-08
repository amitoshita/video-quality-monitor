import type { Reason } from "./types";

/** Human text for each reason code, phrased to read as "Poor: too dark". */
export const REASON_TEXT: Record<Reason, string> = {
  no_face: "no face",
  too_dark: "too dark",
  too_bright: "too bright",
  hold_still: "hold still",
  low_fps: "low FPS",
};
