import { describe, expect, it, vi } from "vitest";
import { HashRouter, href, parseHash, type RouterWindow } from "./router";

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

/** A fake window: navigate() changes the hash like a click or Back would, then fires hashchange. */
function fakeWindow(initial = "#/") {
  let onHashChange: () => void = () => {};
  const win: RouterWindow = {
    location: { hash: initial },
    history: {
      replaceState: vi.fn((_data: unknown, _unused: string, url: string) => {
        win.location.hash = url;
      }),
    },
    addEventListener: (_type, listener) => {
      onHashChange = listener;
    },
  };
  const navigate = (hash: string) => {
    win.location.hash = hash;
    onHashChange();
  };
  return { win, navigate };
}

describe("HashRouter leave guard", () => {
  it("navigates freely without a guard", () => {
    const { win, navigate } = fakeWindow();
    const router = new HashRouter(win);
    const listener = vi.fn();
    router.subscribe(listener);

    navigate("#/history");

    expect(router.hash).toBe("#/history");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stays on the live screen when the guard says no", () => {
    const { win, navigate } = fakeWindow();
    const router = new HashRouter(win);
    const listener = vi.fn();
    router.subscribe(listener);
    const guard = vi.fn(() => false);
    router.setLeaveGuard(guard);

    navigate("#/history");

    expect(guard).toHaveBeenCalledTimes(1);
    expect(router.hash).toBe("#/");
    expect(win.location.hash).toBe("#/"); // URL put back
    expect(listener).not.toHaveBeenCalled(); // nothing re-renders
  });

  it("leaves when the guard says yes", () => {
    const { win, navigate } = fakeWindow();
    const router = new HashRouter(win);
    router.setLeaveGuard(() => true);

    navigate("#/sessions/abc");

    expect(router.hash).toBe("#/sessions/abc");
  });

  it("only guards leaving the live screen", () => {
    const { win, navigate } = fakeWindow("#/history");
    const router = new HashRouter(win);
    const guard = vi.fn(() => false);
    router.setLeaveGuard(guard);

    navigate("#/sessions/abc");
    navigate("#/");

    expect(guard).not.toHaveBeenCalled();
    expect(router.hash).toBe("#/");
  });

  it("stops guarding once the guard is removed", () => {
    const { win, navigate } = fakeWindow();
    const router = new HashRouter(win);
    const remove = router.setLeaveGuard(() => false);

    remove();
    navigate("#/history");

    expect(router.hash).toBe("#/history");
  });
});
