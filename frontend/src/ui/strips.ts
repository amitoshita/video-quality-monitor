import type { Sample } from "../metrics/types";
import { verdictText } from "./format";

/** Configuration for the two status strips shown under the charts. */
export const faceStrip = {
  label: "Face",
  isOk: (s: Sample) => s.face,
  describe: (s: Sample) => (s.face ? "face" : "no face"),
};

export const verdictStrip = {
  label: "Verdict",
  isOk: (s: Sample) => s.verdict === "good",
  describe: verdictText,
};
