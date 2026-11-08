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

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
  };
}

/** The current route; re-renders on navigation. Returns the hash string so React can compare it. */
export function useRoute(): Route {
  return parseHash(useSyncExternalStore(subscribe, () => window.location.hash));
}
