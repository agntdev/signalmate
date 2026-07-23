/** Durable domain types for the trading-signal bot. */

export type InviteStatus = "active" | "unsubscribed";
export type ActivationStatus = "active" | "used" | "revoked";
export type SignalAction = "buy" | "sell";

export interface UserRecord {
  telegramId: number;
  chatId: number;
  inviteStatus: InviteStatus;
  /** Local digest time as "HH:MM" (24h). Default "18:00". */
  digestSchedule: string;
  notificationMute: boolean;
  /** IANA timezone; falls back to "UTC" when unknown. */
  timezone: string;
  joinedAt: number;
  activatedInviteToken?: string;
  displayName?: string;
  /** Last calendar day (YYYY-MM-DD in user TZ) a digest was sent. */
  lastDigestDay?: string;
}

export interface InviteLink {
  token: string;
  createdBy: number;
  isSingleUse: boolean;
  activationStatus: ActivationStatus;
  createdAt: number;
  usedBy?: number;
  usedAt?: number;
  label?: string;
}

export interface Signal {
  id: string;
  timestamp: number;
  asset: string;
  action: SignalAction;
  price: string;
  confidence: number;
  notes: string;
  source: string;
}

export interface Digest {
  id: string;
  windowStart: number;
  windowEnd: number;
  signalIds: string[];
  sentAt?: number;
}

export interface AppConfig {
  /** Default digest hour (0–23). */
  defaultDigestHour: number;
  /** Default digest minute (0–59). */
  defaultDigestMinute: number;
  /** When true, new signals are stored but not broadcast live. */
  maintenance: boolean;
}

export interface FailedDelivery {
  chatId: number;
  text: string;
  attempts: number;
  lastAttemptAt: number;
  kind: "signal" | "digest" | "invite_notify";
  refId?: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  defaultDigestHour: 18,
  defaultDigestMinute: 0,
  maintenance: false,
};

export const DEFAULT_DIGEST_SCHEDULE = "18:00";
export const DEFAULT_TIMEZONE = "UTC";
