import type { Ctx } from "../bot.js";
import * as copy from "./copy.js";
import {
  ensureOwnerBootstrap,
  getUser,
  isOwner,
} from "./store.js";
import type { UserRecord } from "./types.js";

export async function requireSubscriber(
  ctx: Ctx,
): Promise<UserRecord | null> {
  const id = ctx.from?.id;
  if (id == null) return null;
  const user = await getUser(id);
  if (!user || user.inviteStatus !== "active") {
    await ctx.reply(copy.notSubscriber());
    return null;
  }
  // Keep chat id fresh (user may have restarted chat).
  if (ctx.chat?.id != null && user.chatId !== ctx.chat.id) {
    user.chatId = ctx.chat.id;
    const { saveUser } = await import("./store.js");
    await saveUser(user);
  }
  return user;
}

export async function requireOwner(ctx: Ctx): Promise<boolean> {
  const id = ctx.from?.id;
  if (id == null) return false;
  await ensureOwnerBootstrap(id);
  if (!(await isOwner(id))) {
    await ctx.reply("Owner tools are limited to the bot owner.");
    return false;
  }
  return true;
}

export async function userIsOwner(userId: number): Promise<boolean> {
  await ensureOwnerBootstrap(userId);
  return isOwner(userId);
}
