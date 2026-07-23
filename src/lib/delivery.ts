/**
 * Live signal + digest delivery. Tolerates 403 (user blocked / never started)
 * without aborting the rest of the loop. Failed sends go on a retry queue.
 */

import type { Api } from "grammy";
import type { InlineKeyboardMarkup } from "../toolkit/ui/keyboard.js";
import {
  createDigest,
  enqueueFailed,
  getActiveSubscribers,
  getFailedDeliveries,
  saveUser,
  setFailedDeliveries,
  signalsInWindow,
} from "./store.js";
import type { Signal, UserRecord } from "./types.js";
import { now } from "./clock.js";
import { dayKeyInTz, formatDigest, formatSignal, safeTz } from "./format.js";

export interface SendResult {
  sent: number;
  failed: number;
  skippedMuted: number;
}

async function safeSend(
  api: Api,
  chatId: number,
  text: string,
  extra?: { reply_markup?: InlineKeyboardMarkup },
): Promise<boolean> {
  try {
    await api.sendMessage(chatId, text, extra);
    return true;
  } catch {
    return false;
  }
}

/** Broadcast a live signal to all active, unmuted subscribers. */
export async function broadcastSignal(
  api: Api,
  signal: Signal,
  keyboard?: InlineKeyboardMarkup,
): Promise<SendResult> {
  const subs = await getActiveSubscribers();
  let sent = 0;
  let failed = 0;
  let skippedMuted = 0;
  const text = formatSignal(signal);

  for (const u of subs) {
    if (u.notificationMute) {
      skippedMuted++;
      continue;
    }
    const ok = await safeSend(api, u.chatId, text, keyboard ? { reply_markup: keyboard } : undefined);
    if (ok) sent++;
    else {
      failed++;
      await enqueueFailed({
        chatId: u.chatId,
        text,
        attempts: 1,
        lastAttemptAt: now(),
        kind: "signal",
        refId: signal.id,
      });
    }
  }
  return { sent, failed, skippedMuted };
}

/** Notify owners that an invite was activated. */
export async function notifyOwnersOfActivation(
  api: Api,
  ownerIds: number[],
  message: string,
): Promise<void> {
  for (const id of ownerIds) {
    const ok = await safeSend(api, id, message);
    if (!ok) {
      await enqueueFailed({
        chatId: id,
        text: message,
        attempts: 1,
        lastAttemptAt: now(),
        kind: "invite_notify",
      });
    }
  }
}

/**
 * Build today's digest for a subscriber (signals since local midnight-ish:
 * all signals whose dayKey matches today in their TZ).
 */
export async function signalsForUserDay(user: UserRecord, atMs: number = now()): Promise<Signal[]> {
  const tz = safeTz(user.timezone);
  const day = dayKeyInTz(atMs, tz);
  // Look back 48h of wall time and filter by local day key — covers TZ edges.
  const windowStart = atMs - 48 * 60 * 60 * 1000;
  const candidates = await signalsInWindow(windowStart, atMs);
  return candidates.filter((s) => dayKeyInTz(s.timestamp, tz) === day);
}

/** Send a digest to one user; updates lastDigestDay on success. */
export async function sendDigestToUser(
  api: Api,
  user: UserRecord,
  signals: Signal[],
  atMs: number = now(),
): Promise<boolean> {
  const tz = safeTz(user.timezone);
  const day = dayKeyInTz(atMs, tz);
  const text = formatDigest(signals, day);
  const ok = await safeSend(api, user.chatId, text);
  if (ok) {
    user.lastDigestDay = day;
    await saveUser(user);
  } else {
    await enqueueFailed({
      chatId: user.chatId,
      text,
      attempts: 1,
      lastAttemptAt: now(),
      kind: "digest",
    });
  }
  return ok;
}

/** Compile and send digests to every due active subscriber. */
export async function runDueDigests(api: Api, atMs: number = now()): Promise<SendResult> {
  const { isDueDigest } = await import("./format.js");
  const subs = await getActiveSubscribers();
  let sent = 0;
  let failed = 0;
  let skippedMuted = 0;
  const allSignalIds = new Set<string>();
  let windowStart = atMs;
  let windowEnd = 0;

  for (const u of subs) {
    if (!isDueDigest(u.digestSchedule, safeTz(u.timezone), u.lastDigestDay, atMs)) continue;
    const signals = await signalsForUserDay(u, atMs);
    for (const s of signals) allSignalIds.add(s.id);
    if (signals.length > 0) {
      windowStart = Math.min(windowStart, signals[0]!.timestamp);
      windowEnd = Math.max(windowEnd, signals[signals.length - 1]!.timestamp);
    }
    const ok = await sendDigestToUser(api, u, signals, atMs);
    if (ok) sent++;
    else failed++;
  }

  if (sent > 0) {
    await createDigest(
      windowEnd === 0 ? atMs : windowStart,
      windowEnd === 0 ? atMs : windowEnd,
      [...allSignalIds],
    );
  }

  return { sent, failed, skippedMuted };
}

/** Force-send today's digest to all active subscribers (owner action). */
export async function forceSendDigest(api: Api, atMs: number = now()): Promise<{
  signalCount: number;
  recipients: number;
}> {
  const subs = await getActiveSubscribers();
  const allIds = new Set<string>();
  let recipients = 0;
  let windowStart = atMs;
  let windowEnd = 0;

  for (const u of subs) {
    const signals = await signalsForUserDay(u, atMs);
    for (const s of signals) allIds.add(s.id);
    if (signals.length > 0) {
      windowStart = Math.min(windowStart, signals[0]!.timestamp);
      windowEnd = Math.max(windowEnd, signals[signals.length - 1]!.timestamp);
    }
    // Force: ignore mute for owner-triggered digest? Spec says daily digest to
    // active subscribers — mute is for live alerts. Digests still go out.
    const ok = await sendDigestToUser(api, u, signals, atMs);
    if (ok) recipients++;
  }

  if (recipients > 0 || allIds.size > 0) {
    await createDigest(
      windowEnd === 0 ? atMs : windowStart,
      windowEnd === 0 ? atMs : windowEnd,
      [...allIds],
    );
  }

  return { signalCount: allIds.size, recipients };
}

/** Retry failed deliveries once (best-effort). */
export async function retryFailedDeliveries(api: Api): Promise<number> {
  const list = await getFailedDeliveries();
  if (list.length === 0) return 0;
  const remaining = [];
  let recovered = 0;
  for (const f of list) {
    if (f.attempts >= 3) continue; // drop after 3 tries
    const ok = await safeSend(api, f.chatId, f.text);
    if (ok) recovered++;
    else {
      remaining.push({
        ...f,
        attempts: f.attempts + 1,
        lastAttemptAt: now(),
      });
    }
  }
  await setFailedDeliveries(remaining);
  return recovered;
}
