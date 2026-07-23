import type { Signal, SignalAction } from "./types.js";
import { now } from "./clock.js";

export function actionLabel(action: SignalAction): string {
  return action === "buy" ? "BUY" : "SELL";
}

export function formatSignal(s: Signal): string {
  const conf = Number.isFinite(s.confidence) ? `${s.confidence}%` : "—";
  const lines = [
    `${actionLabel(s.action)} ${s.asset}`,
    `Price: ${s.price}`,
    `Confidence: ${conf}`,
  ];
  if (s.notes?.trim()) lines.push(`Notes: ${s.notes.trim()}`);
  if (s.source?.trim()) lines.push(`Source: ${s.source.trim()}`);
  lines.push(`ID: ${s.id}`);
  return lines.join("\n");
}

export function formatSignalShort(s: Signal): string {
  return `${actionLabel(s.action)} ${s.asset} @ ${s.price} (${s.confidence}%)`;
}

export function formatDigest(signals: Signal[], windowLabel: string): string {
  if (signals.length === 0) {
    return `Daily digest — ${windowLabel}\n\nNo signals in this window.`;
  }
  const body = signals.map((s, i) => `${i + 1}. ${formatSignalShort(s)}`).join("\n");
  return `Daily digest — ${windowLabel}\n\n${body}`;
}

/** Format a timestamp in a given IANA timezone as HH:MM. Falls back to UTC. */
export function formatTimeInTz(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timeZone || "UTC",
    }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(new Date(ms));
  }
}

/** Calendar day YYYY-MM-DD in the given timezone. */
export function dayKeyInTz(ms: number, timeZone: string): string {
  try {
    // en-CA yields YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timeZone || "UTC",
    }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    }).format(new Date(ms));
  }
}

/** Local hour and minute (0–23, 0–59) in the given timezone. */
export function localHourMinute(ms: number, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: safeTz(timeZone),
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour: hour === 24 ? 0 : hour, minute };
}

export function safeTz(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Parse "HH:MM" into hour/minute. Returns null if invalid. */
export function parseSchedule(s: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function scheduleLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Start of the local calendar day in ms (approx via iterative search is heavy;
 *  we use a simpler approach: filter signals by dayKeyInTz equality). */
export function isDueDigest(
  schedule: string,
  timeZone: string,
  lastDigestDay: string | undefined,
  atMs: number = now(),
): boolean {
  const parsed = parseSchedule(schedule);
  if (!parsed) return false;
  const { hour, minute } = localHourMinute(atMs, timeZone);
  if (hour < parsed.hour || (hour === parsed.hour && minute < parsed.minute)) return false;
  const day = dayKeyInTz(atMs, timeZone);
  if (lastDigestDay === day) return false;
  return true;
}
