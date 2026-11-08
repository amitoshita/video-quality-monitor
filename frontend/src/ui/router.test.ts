import { describe, expect, it } from "vitest";
import { href, parseHash } from "./router";

describe("parseHash", () => {
  it.each([
    ["", { name: "live" }],
    ["#/", { name: "live" }],
    ["#/history", { name: "history" }],
    ["#/sessions/4f4736d2-e909", { name: "session", id: "4f4736d2-e909" }],
    ["#/sessions/", { name: "live" }],
    ["#/nope", { name: "live" }],
  ] as const)("%s", (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it("round-trips session links", () => {
    expect(parseHash(href.session("a b/c"))).toEqual({ name: "session", id: "a b/c" });
  });
});
