/**
 * Invite join paths:
 *  - Deep link: /start invite_<token>  (handled in start.ts)
 *  - Typed join code via "Enter code" button
 *
 * Keeps a live registration so this module is never an empty stub.
 */

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import * as copy from "../lib/copy.js";
import { ownerMenu, subscriberMenu } from "../lib/menu.js";
import {
  addSubscriber,
  getConfig,
  getInvite,
  getOwnerIds,
  getUser,
  isOwner,
  recordActivation,
  saveInvite,
} from "../lib/store.js";
import { DEFAULT_DIGEST_SCHEDULE, DEFAULT_TIMEZONE, type UserRecord } from "../lib/types.js";
import { now } from "../lib/clock.js";
import { notifyOwnersOfActivation } from "../lib/delivery.js";
import { scheduleLabel } from "../lib/format.js";

const composer = new Composer<Ctx>();

async function redeem(ctx: Ctx, token: string): Promise<void> {
  const userId = ctx.from?.id;
  if (userId == null || ctx.chat == null) return;

  const existing = await getUser(userId);
  if (existing && existing.inviteStatus === "active") {
    const owner = await isOwner(userId);
    await ctx.reply(copy.inviteAlreadyMember(), {
      reply_markup: owner ? ownerMenu() : subscriberMenu(),
    });
    return;
  }

  const invite = await getInvite(token.trim());
  if (!invite || invite.activationStatus !== "active") {
    await ctx.reply(copy.inviteInvalid());
    return;
  }

  const cfg = await getConfig();
  const user: UserRecord = {
    telegramId: userId,
    chatId: ctx.chat.id,
    inviteStatus: "active",
    digestSchedule:
      scheduleLabel(cfg.defaultDigestHour, cfg.defaultDigestMinute) || DEFAULT_DIGEST_SCHEDULE,
    notificationMute: false,
    timezone: DEFAULT_TIMEZONE,
    joinedAt: now(),
    activatedInviteToken: invite.token,
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
    token: invite.token,
    userId,
    at: now(),
    name: ctx.from?.first_name,
  });

  const owners = await getOwnerIds();
  const name = ctx.from?.first_name ?? "A user";
  await notifyOwnersOfActivation(
    ctx.api,
    owners.filter((id) => id !== userId),
    `Invite activated: ${name} joined via ${invite.token}.`,
  );

  ctx.session.step = "idle";
  const owner = await isOwner(userId);
  await ctx.reply(copy.ONBOARD_WELCOME, {
    reply_markup: owner ? ownerMenu() : subscriberMenu(),
  });
}

composer.callbackQuery("invite:code", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "await_join_code";
  await ctx.editMessageText("Send your invite code as a message.\n\nTap Cancel to go back.", {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "menu:main")]]),
  });
});

// Typed join code (and a soft alias for deep-link style text).
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "await_join_code") {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      ctx.session.step = "idle";
      return next();
    }
    let token = text;
    if (token.startsWith("invite_")) token = token.slice("invite_".length);
    if (token.startsWith("join_")) token = token.slice("join_".length);
    await redeem(ctx, token);
    return;
  }

  // Soft support for legacy "/invite:TOKEN" style messages (not a real command).
  const m = /^\/invite:(\S+)/i.exec(ctx.message.text.trim());
  if (m) {
    await redeem(ctx, m[1]!);
    return;
  }

  return next();
});

export default composer;
