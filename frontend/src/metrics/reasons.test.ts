import { describe, expect, it } from "vitest";
import { REASON_TEXT } from "./reasons";
import { REASONS } from "./types";

describe("REASON_TEXT", () => {
  it("has text for every reason, in the backend's order", () => {
    expect(REASONS).toEqual(["no_face", "too_dark", "too_bright", "hold_still", "low_fps"]);
    for (const reason of REASONS) expect(REASON_TEXT[reason]).toMatch(/\S/);
  });
});
