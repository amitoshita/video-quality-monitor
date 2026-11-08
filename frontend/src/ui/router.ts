import { useSyncExternalStore } from "react";

/** Hash routes, so the static host needs no rewrite rules: #/, #/history, #/sessions/<id>. */
export type Route = { name: "live" } | { name: "history" } | { name: "session"; id: string };

export const href = {
  live: "#/",
  history: "#/history",
  session: (id: string) => `#/sessions/${encodeURIComponent(id)}`,
};

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "");
  if (path === "/history") return { name: "history" };
  const match = /^\/sessions\/([^/]+)$/.exec(path);
  if (match?.[1]) return { name: "session", id: decodeURIComponent(match[1]) };
  return { name: "live" };
}

/** The parts of `window` the router uses (narrowed so tests can fake it). */
export interface RouterWindow {
  location: { hash: string };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  addEventListener(type: "hashchange", listener: () => void): void;
}

/**
 * Tracks the hash and lets the live screen veto leaving it. Covers every way of navigating:
 * links, the Back button, and a typed URL. A vetoed navigation puts the previous hash back
 * (replaceState fires no hashchange), so nothing re-renders.
 */
export class HashRouter {
  private current: string;
  private readonly listeners = new Set<() => void>();
  private leaveGuard: (() => boolean) | null = null;
  private readonly win: RouterWindow;

  constructor(win: RouterWindow) {
    this.win = win;
    this.current = win.location.hash;
    win.addEventListener("hashchange", this.onHashChange);
  }

  get hash(): string {
    return this.current;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** `guard` returns false to stay on the live screen. Returns a function that removes it. */
  setLeaveGuard(guard: () => boolean): () => void {
    this.leaveGuard = guard;
    return () => {
      if (this.leaveGuard === guard) this.leaveGuard = null;
    };
  }

  private readonly onHashChange = () => {
    const next = this.win.location.hash;
    const leavingLive = parseHash(this.current).name === "live" && parseHash(next).name !== "live";
    if (leavingLive && this.leaveGuard && !this.leaveGuard()) {
      this.win.history.replaceState(null, "", this.current || "#/");
      return;
    }
    this.current = next;
    for (const listener of this.listeners) listener();
  };
}

let router: HashRouter | null = null;

/** The app's router, created on first use. */
export function appRouter(): HashRouter {
  router ??= new HashRouter(window);
  return router;
}

/** The current route; re-renders on navigation. */
export function useRoute(): Route {
  const r = appRouter();
  return parseHash(useSyncExternalStore(r.subscribe, () => r.hash));
}
