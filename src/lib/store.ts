/**
 * Durable domain storage — Redis when REDIS_URL is set, otherwise the
 * toolkit's MemorySessionStorage (dev + test harness). Never scan the
 * keyspace: every collection has an explicit index record.
 */

import type { StorageAdapter } from "grammy";
import { MemorySessionStorage } from "../toolkit/session/memory.js";
import type {
  AppConfig,
  Digest,
  FailedDelivery,
  InviteLink,
  Signal,
  UserRecord,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { now } from "./clock.js";

// ── low-level adapter ────────────────────────────────────────────────

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

let memory = new MemorySessionStorage<Json>();
let redisAdapter: StorageAdapter<Json> | null = null;
let useMemory = true;

function envRedisUrl(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.REDIS_URL;
}

function getAdapter(): StorageAdapter<Json> {
  const url = envRedisUrl();
  if (url) {
    if (!redisAdapter) {
      redisAdapter = lazyRedisAdapter(url);
      useMemory = false;
    }
    return redisAdapter;
  }
  useMemory = true;
  return memory;
}

/**
 * Lazy Redis adapter (dynamic import of ioredis) so the Workers bundle never
 * statically pulls node-only packages. Mirrors toolkit/session/redis.ts.
 */
function lazyRedisAdapter(url: string): StorageAdapter<Json> {
  let inner: Promise<StorageAdapter<Json>> | null = null;
  const get = (): Promise<StorageAdapter<Json>> =>
    (inner ??= (async () => {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ioredis: any = require("ioredis");
      const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
      const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
      const prefix = "kv:";
      return {
        async read(key: string): Promise<Json | undefined> {
          const raw = await client.get(prefix + key);
          if (raw == null) return undefined;
          try {
            return JSON.parse(raw) as Json;
          } catch {
            return undefined;
          }
        },
        async write(key: string, value: Json): Promise<void> {
          await client.set(prefix + key, JSON.stringify(value));
        },
        async delete(key: string): Promise<void> {
          await client.del(prefix + key);
        },
      };
    })());
  return {
    read: async (key) => (await get()).read(key),
    write: async (key, value) => {
      await (await get()).write(key, value);
    },
    delete: async (key) => {
      await (await get()).delete(key);
    },
  };
}

/** Test-only: wipe in-memory domain data so each harness spec starts clean. */
export function resetDomainStore(): void {
  memory = new MemorySessionStorage<Json>();
  if (useMemory || !envRedisUrl()) {
    redisAdapter = null;
    useMemory = true;
  }
}

async function getJson<T>(key: string): Promise<T | undefined> {
  const v = await getAdapter().read(key);
  return v as T | undefined;
}

async function setJson<T>(key: string, value: T): Promise<void> {
  await getAdapter().write(key, value as unknown as Json);
}

async function delKey(key: string): Promise<void> {
  await getAdapter().delete(key);
}

// ── keys ─────────────────────────────────────────────────────────────

const K = {
  user: (id: number) => `user:${id}`,
  invite: (token: string) => `invite:${token}`,
  signal: (id: string) => `signal:${id}`,
  digest: (id: string) => `digest:${id}`,
  subscribers: "idx:subscribers",
  owners: "idx:owners",
  invites: "idx:invites",
  signals: "idx:signals",
  digests: "idx:digests",
  userInvites: (id: number) => `idx:user_invites:${id}`,
  config: "config:app",
  failed: "idx:failed_deliveries",
  seq: (name: string) => `seq:${name}`,
  activations: "idx:activations",
} as const;

async function nextSeq(name: string): Promise<number> {
  const key = K.seq(name);
  const cur = (await getJson<number>(key)) ?? 0;
  const n = cur + 1;
  await setJson(key, n);
  return n;
}

// ── config ───────────────────────────────────────────────────────────

export async function getConfig(): Promise<AppConfig> {
  const c = await getJson<AppConfig>(K.config);
  return c ? { ...DEFAULT_CONFIG, ...c } : { ...DEFAULT_CONFIG };
}

export async function setConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const cur = await getConfig();
  const next = { ...cur, ...patch };
  await setJson(K.config, next);
  return next;
}

// ── owners ───────────────────────────────────────────────────────────

export async function getOwnerIds(): Promise<number[]> {
  return (await getJson<number[]>(K.owners)) ?? [];
}

export async function addOwner(userId: number): Promise<void> {
  const ids = await getOwnerIds();
  if (!ids.includes(userId)) {
    ids.push(userId);
    await setJson(K.owners, ids);
  }
}

export async function isOwner(userId: number): Promise<boolean> {
  const env = typeof process !== "undefined" ? process.env.OWNER_TELEGRAM_ID : undefined;
  if (env && String(userId) === String(env).trim()) return true;
  const ids = await getOwnerIds();
  return ids.includes(userId);
}

/**
 * Bootstrap: if no owners exist and no OWNER_TELEGRAM_ID is set, the first
 * person to start the bot becomes the owner so owner controls are reachable
 * in dev/test without a secret.
 */
export async function ensureOwnerBootstrap(userId: number): Promise<boolean> {
  const env = typeof process !== "undefined" ? process.env.OWNER_TELEGRAM_ID : undefined;
  if (env) {
    if (String(userId) === String(env).trim()) {
      await addOwner(userId);
      return true;
    }
    return false;
  }
  const ids = await getOwnerIds();
  if (ids.length === 0) {
    await addOwner(userId);
    return true;
  }
  return ids.includes(userId);
}

// ── users ────────────────────────────────────────────────────────────

export async function getUser(telegramId: number): Promise<UserRecord | undefined> {
  return getJson<UserRecord>(K.user(telegramId));
}

export async function saveUser(user: UserRecord): Promise<void> {
  await setJson(K.user(user.telegramId), user);
}

export async function deleteUser(telegramId: number): Promise<void> {
  await delKey(K.user(telegramId));
  const subs = await getSubscriberIds();
  const next = subs.filter((id) => id !== telegramId);
  await setJson(K.subscribers, next);
}

export async function getSubscriberIds(): Promise<number[]> {
  return (await getJson<number[]>(K.subscribers)) ?? [];
}

export async function getActiveSubscribers(): Promise<UserRecord[]> {
  const ids = await getSubscriberIds();
  const out: UserRecord[] = [];
  for (const id of ids) {
    const u = await getUser(id);
    if (u && u.inviteStatus === "active") out.push(u);
  }
  return out;
}

export async function addSubscriber(user: UserRecord): Promise<void> {
  await saveUser(user);
  const ids = await getSubscriberIds();
  if (!ids.includes(user.telegramId)) {
    ids.push(user.telegramId);
    await setJson(K.subscribers, ids);
  }
}

// ── invites ──────────────────────────────────────────────────────────

export async function getInvite(token: string): Promise<InviteLink | undefined> {
  return getJson<InviteLink>(K.invite(token));
}

export async function saveInvite(invite: InviteLink): Promise<void> {
  await setJson(K.invite(invite.token), invite);
  const tokens = (await getJson<string[]>(K.invites)) ?? [];
  if (!tokens.includes(invite.token)) {
    tokens.push(invite.token);
    await setJson(K.invites, tokens);
  }
  const byUser = (await getJson<string[]>(K.userInvites(invite.createdBy))) ?? [];
  if (!byUser.includes(invite.token)) {
    byUser.push(invite.token);
    await setJson(K.userInvites(invite.createdBy), byUser);
  }
}

export async function listInviteTokens(): Promise<string[]> {
  return (await getJson<string[]>(K.invites)) ?? [];
}

export async function listInvitesByUser(userId: number): Promise<InviteLink[]> {
  const tokens = (await getJson<string[]>(K.userInvites(userId))) ?? [];
  const out: InviteLink[] = [];
  for (const t of tokens) {
    const inv = await getInvite(t);
    if (inv) out.push(inv);
  }
  return out;
}

export async function createInvite(
  createdBy: number,
  opts?: { singleUse?: boolean; label?: string },
): Promise<InviteLink> {
  const n = await nextSeq("invite");
  const token = `inv${n}`;
  const invite: InviteLink = {
    token,
    createdBy,
    isSingleUse: opts?.singleUse !== false, // single-use by default
    activationStatus: "active",
    createdAt: now(),
    label: opts?.label,
  };
  await saveInvite(invite);
  return invite;
}

export interface ActivationEvent {
  token: string;
  userId: number;
  at: number;
  name?: string;
}

export async function recordActivation(ev: ActivationEvent): Promise<void> {
  const list = (await getJson<ActivationEvent[]>(K.activations)) ?? [];
  list.push(ev);
  // keep last 100
  await setJson(K.activations, list.slice(-100));
}

export async function recentActivations(limit = 10): Promise<ActivationEvent[]> {
  const list = (await getJson<ActivationEvent[]>(K.activations)) ?? [];
  return list.slice(-limit).reverse();
}

// ── signals ──────────────────────────────────────────────────────────

export async function getSignal(id: string): Promise<Signal | undefined> {
  return getJson<Signal>(K.signal(id));
}

export async function listSignalIds(): Promise<string[]> {
  return (await getJson<string[]>(K.signals)) ?? [];
}

export async function listRecentSignals(limit = 20): Promise<Signal[]> {
  const ids = await listSignalIds();
  const out: Signal[] = [];
  for (const id of ids.slice(0, limit)) {
    const s = await getSignal(id);
    if (s) out.push(s);
  }
  return out;
}

export async function createSignal(
  data: Omit<Signal, "id" | "timestamp"> & { timestamp?: number },
): Promise<Signal> {
  const n = await nextSeq("signal");
  const signal: Signal = {
    id: `sig${n}`,
    timestamp: data.timestamp ?? now(),
    asset: data.asset,
    action: data.action,
    price: data.price,
    confidence: data.confidence,
    notes: data.notes,
    source: data.source,
  };
  await setJson(K.signal(signal.id), signal);
  const ids = await listSignalIds();
  ids.unshift(signal.id);
  await setJson(K.signals, ids);
  return signal;
}

export async function signalsInWindow(startMs: number, endMs: number): Promise<Signal[]> {
  // Walk the newest-first index; stop once we're past the window start.
  const ids = await listSignalIds();
  const out: Signal[] = [];
  for (const id of ids) {
    const s = await getSignal(id);
    if (!s) continue;
    if (s.timestamp > endMs) continue;
    if (s.timestamp < startMs) break;
    out.push(s);
  }
  return out.reverse(); // chronological
}

// ── digests ──────────────────────────────────────────────────────────

export async function saveDigest(d: Digest): Promise<void> {
  await setJson(K.digest(d.id), d);
  const ids = (await getJson<string[]>(K.digests)) ?? [];
  if (!ids.includes(d.id)) {
    ids.unshift(d.id);
    await setJson(K.digests, ids.slice(0, 90));
  }
}

export async function createDigest(
  windowStart: number,
  windowEnd: number,
  signalIds: string[],
): Promise<Digest> {
  const n = await nextSeq("digest");
  const d: Digest = {
    id: `dig${n}`,
    windowStart,
    windowEnd,
    signalIds,
    sentAt: now(),
  };
  await saveDigest(d);
  return d;
}

// ── failed deliveries (retry queue) ──────────────────────────────────

export async function getFailedDeliveries(): Promise<FailedDelivery[]> {
  return (await getJson<FailedDelivery[]>(K.failed)) ?? [];
}

export async function enqueueFailed(f: FailedDelivery): Promise<void> {
  const list = await getFailedDeliveries();
  list.push(f);
  await setJson(K.failed, list.slice(-200));
}

export async function setFailedDeliveries(list: FailedDelivery[]): Promise<void> {
  await setJson(K.failed, list);
}
