import { describe, expect, it } from "vitest";
import { toCameraError } from "./camera";

describe("toCameraError", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["NotFoundError", "not_found"],
    ["NotReadableError", "in_use"],
    ["OverconstrainedError", "overconstrained"],
    ["SecurityError", "insecure"],
    ["SomethingNew", "unknown"],
  ] as const)("%s -> %s with a human message", (name, kind) => {
    const error = toCameraError(new DOMException("browser text", name));
    expect(error.kind).toBe(kind);
    expect(error.message.length).toBeGreaterThan(20);
  });

  it("tells the user how to re-enable a denied camera", () => {
    expect(toCameraError(new DOMException("", "NotAllowedError")).message).toMatch(/Allow/);
  });

  it("handles non-Error rejections", () => {
    expect(toCameraError("weird").message).toBe("Could not open the camera: weird");
  });
});
