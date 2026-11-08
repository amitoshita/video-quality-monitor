import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { classifySendError } from "./transport";

describe("classifySendError", () => {
  it.each([
    [500, "retry"],
    [502, "retry"],
    [503, "retry"],
    [408, "retry"],
    [429, "retry"],
    [422, "rejected"],
    [400, "rejected"],
    [404, "gone"],
  ] as const)("HTTP %i -> %s", (status, kind) => {
    expect(classifySendError(new ApiError(status, "x", "y")).kind).toBe(kind);
  });

  it("retries network failures and timeouts", () => {
    expect(classifySendError(new TypeError("Failed to fetch"))).toEqual({
      kind: "retry",
      error: "Failed to fetch",
    });
    expect(classifySendError(new DOMException("signal timed out", "TimeoutError"))).toEqual({
      kind: "retry",
      error: "request timed out",
    });
  });
});
