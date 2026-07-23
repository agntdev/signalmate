import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import * as copy from "../lib/copy.js";
import { ownerMenu, strangerMenu, subscriberMenu } from "../lib/menu.js";
import {
  addSubscriber,
  ensureOwnerBootstrap,
  getConfig,
  getInvite,
  getOwnerIds,
  getUser,
  isOwner,
  recordActivation,
  saveInvite,
  saveUser,
} from "../lib/store.js";
import { DEFAULT_DIGEST_SCHEDULE, DEFAULT_TIMEZONE, type UserRecord } from "../lib/types.js";
import { now } from "../lib/clock.js";
import { notifyOwnersOfActivation, retryFailedDeliveries, runDueDigests } from "../lib/delivery.js";
import { scheduleLabel } from "../lib/format.js";
import type { InlineKeyboardMarkup } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

function clearFlow(ctx: Ctx): void {
  ctx.session.step = "idle";
  ctx.session.draftSignal = undefined;
}

function menuFor(active: boolean, owner: boolean): InlineKeyboardMarkup {
  if (!active) return strangerMenu();
  return owner ? ownerMenu() : subscriberMenu();
}

async function redeemInvite(ctx: Ctx, token: string): Promise<void> {
  const userId = ctx.from?.id;
  if (userId == null || ctx.chat == null) return;

  const existing = await getUser(userId);
  if (existing && existing.inviteStatus === "active") {
    const owner = await isOwner(userId);
    await ctx.reply(copy.inviteAlreadyMember(), {
      reply_markup: menuFor(true, owner),
    });
    return;
  }

  const invite = await getInvite(token);
  if (!invite || invite.activationStatus !== "active") {
    await ctx.reply(copy.inviteInvalid());
    return;
  }

  const cfg = await getConfig();
  const digest = scheduleLabel(cfg.defaultDigestHour, cfg.defaultDigestMinute);

  const user: UserRecord = {
    telegramId: userId,
    chatId: ctx.chat.id,
    inviteStatus: "active",
    digestSchedule: digest || DEFAULT_DIGEST_SCHEDULE,
    notificationMute: false,
    timezone: DEFAULT_TIMEZONE,
    joinedAt: now(),
    activatedInviteToken: token,
    displayName: ctx.from?.first_name,
  };
  await addSubscriber(user);

  if (invite.isSingleUse) {
    invite.activationStatus = "used";
    invite.usedBy = userId;
    invite.usedAt = now();
    await saveInvite(invite);
  }

  await recordActivation({
    token,
    userId,
    at: now(),
    name: ctx.from?.first_name,
  });

  const owners = await getOwnerIds();
  const name = ctx.from?.first_name ?? "A user";
  await notifyOwnersOfActivation(
    ctx.api,
    owners.filter((id) => id !== userId),
    `Invite activated: ${name} joined via ${token}.`,
  );

  const owner = await isOwner(userId);
  await ctx.reply(copy.ONBOARD_WELCOME, { reply_markup: menuFor(true, owner) });
}

/** Extract invite token from /start payload. */
function parseStartPayload(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = /^\/start(?:@\w+)?(?:\s+(.+))?$/i.exec(text.trim());
  const raw = m?.[1]?.trim();
  if (!raw) return undefined;
  if (raw.startsWith("invite_")) return raw.slice("invite_".length);
  if (raw.startsWith("join_")) return raw.slice("join_".length);
  return raw;
}

composer.command("start", async (ctx) => {
  clearFlow(ctx);
  const userId = ctx.from?.id;
  if (userId == null) return;

  void retryFailedDeliveries(ctx.api).catch(() => {});
  void runDueDigests(ctx.api).catch(() => {});

  await ensureOwnerBootstrap(userId);
  const owner = await isOwner(userId);

  const token = parseStartPayload(ctx.message?.text);
  if (token) {
    await redeemInvite(ctx, token);
    return;
  }

  if (owner) {
    let user = await getUser(userId);
    if (!user) {
      const cfg = await getConfig();
      user = {
        telegramId: userId,
        chatId: ctx.chat!.id,
        inviteStatus: "active",
        digestSchedule: scheduleLabel(cfg.defaultDigestHour, cfg.defaultDigestMinute),
        notificationMute: false,
        timezone: DEFAULT_TIMEZONE,
        joinedAt: now(),
        displayName: ctx.from?.first_name,
      };
      await addSubscriber(user);
    } else if (user.inviteStatus !== "active") {
      user.inviteStatus = "active";
      user.chatId = ctx.chat!.id;
      await saveUser(user);
    } else {
      user.chatId = ctx.chat!.id;
      await saveUser(user);
    }
    await ctx.reply(copy.WELCOME_OWNER, { reply_markup: ownerMenu() });
    return;
  }

  const user = await getUser(userId);
  if (user && user.inviteStatus === "active") {
    user.chatId = ctx.chat!.id;
    await saveUser(user);
    await ctx.reply(copy.WELCOME_SUBSCRIBER, { reply_markup: subscriberMenu() });
  } else {
    await ctx.reply(copy.WELCOME_STRANGER, { reply_markup: strangerMenu() });
  }
});

composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  clearFlow(ctx);
  const userId = ctx.from?.id;
  if (userId == null) return;
  await ensureOwnerBootstrap(userId);
  const owner = await isOwner(userId);
  const user = await getUser(userId);
  const active = !!(user && user.inviteStatus === "active");
  const text = active
    ? owner
      ? copy.WELCOME_OWNER
      : copy.WELCOME_SUBSCRIBER
    : copy.WELCOME_STRANGER;
  await ctx.editMessageText(text, { reply_markup: menuFor(active || owner, owner) });
});

export default composer;
export { redeemInvite, parseStartPayload };
