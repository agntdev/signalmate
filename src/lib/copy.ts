/** Professional, concise user-facing copy for the trading signal bot. */

export const DISCLAIMER =
  "Signals are suggestions only — not financial advice. You decide what to trade.";

export const WELCOME_SUBSCRIBER =
  "Trading signals — ready when you are.\n\n" +
  "Tap a button below for settings, history, or help.";

export const WELCOME_OWNER =
  "Owner console ready.\n\n" +
  "Create signals, manage invites, and review subscribers from the menu.";

export const WELCOME_STRANGER =
  "This bot is invite-only.\n\n" +
  "Open a link from the owner, or tap Enter code if you have a join code.";

export const HELP_TEXT =
  "Private trading signals, delivered to you by DM.\n\n" +
  "• Live alerts when a new signal is published\n" +
  "• Daily digest at your chosen local time\n" +
  "• History of recent signals\n\n" +
  "Open /start for the menu. Access is invite-only.\n\n" +
  DISCLAIMER;

export const ONBOARD_WELCOME =
  "You're in. Welcome to private trading signals.\n\n" +
  "You'll get live alerts here and a daily digest at 18:00 local time " +
  "(change that in Settings).\n\n" +
  DISCLAIMER;

export function inviteInvalid(): string {
  return "That invite link isn't valid or has already been used. Ask the owner for a fresh one.";
}

export function inviteAlreadyMember(): string {
  return "You're already subscribed. Open /start for the menu.";
}

export function notSubscriber(): string {
  return "You need an invite to use this bot. Open a link from the owner, or tap Enter code.";
}

export function settingsText(digest: string, muted: boolean, tz: string): string {
  return (
    "Your preferences\n\n" +
    `Digest time: ${digest} (${tz})\n` +
    `Live alerts: ${muted ? "muted" : "on"}\n\n` +
    "Choose what to change:"
  );
}

export function historyEmpty(): string {
  return "No signals yet — check back after the next one is published.";
}

export function unsubscribeConfirm(): string {
  return (
    "Unsubscribe and delete your account?\n\n" +
    "You'll stop receiving signals. You can rejoin later with a new invite."
  );
}

export function unsubscribed(): string {
  return "You're unsubscribed and your account is removed. Take care.";
}

export function linksSubscriber(status: string, token?: string): string {
  const line = token ? `Joined via invite ${token}.` : "Joined via invite.";
  return `Your access: ${status}\n${line}`;
}

export function linksOwnerEmpty(): string {
  return "No invite links yet — tap Create invite to make one.";
}

export function maintenanceBlock(): string {
  return "Maintenance window is active — new signals aren't broadcast right now. Try again later.";
}

export function signalCreated(id: string, asset: string, action: string): string {
  return `Signal ${id} published: ${action.toUpperCase()} ${asset}. Active subscribers notified.`;
}

export function signalCreatedMaintenance(id: string, asset: string, action: string): string {
  return `Signal ${id} saved (${action.toUpperCase()} ${asset}) but not broadcast — maintenance is on.`;
}

export function digestEmpty(): string {
  return "No signals in today's window — nothing to send.";
}

export function digestSent(count: number, recipients: number): string {
  return `Digest sent: ${count} signal(s) to ${recipients} subscriber(s).`;
}

export function statsText(active: number, invites: number, signals: number): string {
  return (
    "Subscriber stats\n\n" +
    `Active subscribers: ${active}\n` +
    `Invite links: ${invites}\n` +
    `Signals published: ${signals}`
  );
}
