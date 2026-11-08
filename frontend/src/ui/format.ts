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
