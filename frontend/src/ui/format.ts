import { REASON_TEXT } from "../metrics/reasons";
import type { Sample } from "../metrics/types";
import type { QueueStatus } from "../pipeline/sampleQueue";

/** One decimal, or an em dash for "not measured" (never a made-up number). */
export function formatLevel(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

export function verdictText(sample: Sample): string {
  return sample.reason === null ? "Good" : `Poor: ${REASON_TEXT[sample.reason]}`;
}

export interface DeliveryInfo {
  tone: "ok" | "busy" | "warn";
  text: string;
}

/** Human summary of the running session's queue. */
export function deliveryText(queue: QueueStatus | null): DeliveryInfo | null {
  if (queue === null) return null;
  const dropped = queue.dropped > 0 ? ` · ${plural(queue.dropped, "sample")} dropped` : "";
  if (queue.failures > 0) {
    return {
      tone: "warn",
      text: `Connection problem: ${plural(queue.pending, "sample")} waiting, retrying${dropped}`,
    };
  }
  if (queue.pending > 0) {
    return { tone: "busy", text: `${plural(queue.pending, "sample")} pending${dropped}` };
  }
  return { tone: "ok", text: `All samples delivered${dropped}` };
}

export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** "1 min 14 s", "45 s", "0 s". */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${String(rest)} s`;
  return rest === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(rest)} s`;
}

/** Summary values are null for a session without samples: show a dash, never 0. */
export function formatStat(value: number | null, unit = ""): string {
  return value === null ? "—" : `${value.toFixed(1)}${unit}`;
}

/**
 * Date and time of an ISO timestamp in the viewer's time zone. The language defaults to the
 * page's own (<html lang>), so dates match the rest of the English UI whatever the OS locale.
 */
export function formatDateTime(iso: string, locale = pageLanguage(), timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

function pageLanguage(): string | undefined {
  return typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
}
