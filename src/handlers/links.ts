import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { requireSubscriber, userIsOwner } from "../lib/access.js";
import * as copy from "../lib/copy.js";
import {
  getInvite,
  getUser,
  listInviteTokens,
  listInvitesByUser,
  saveInvite,
} from "../lib/store.js";

const composer = new Composer<Ctx>();

async function showLinks(ctx: Ctx, edit: boolean): Promise<void> {
  const userId = ctx.from?.id;
  if (userId == null) return;

  const owner = await userIsOwner(userId);
  const user = await getUser(userId);

  if (owner) {
    const invites = await listInvitesByUser(userId);
    // Owners who never created invites: also show all tokens if they are sole owner
    const allTokens = invites.length === 0 ? await listInviteTokens() : invites.map((i) => i.token);
    const list =
      invites.length > 0
        ? invites
        : (
            await Promise.all(allTokens.map((t) => getInvite(t)))
          ).filter((x): x is NonNullable<typeof x> => !!x);

    if (list.length === 0) {
      const text = copy.linksOwnerEmpty();
      const markup = inlineKeyboard([
        [inlineButton("Create invite", "admin:inv_create:single")],
        [inlineButton("Reusable invite", "admin:inv_create:multi")],
        [inlineButton("Back to menu", "menu:main")],
      ]);
      if (edit) await ctx.editMessageText(text, { reply_markup: markup });
      else await ctx.reply(text, { reply_markup: markup });
      return;
    }

    const lines = list
      .slice()
      .reverse()
      .slice(0, 15)
      .map((inv) => {
        const kind = inv.isSingleUse ? "single-use" : "reusable";
        const status = inv.activationStatus;
        return `• ${inv.token} — ${kind}, ${status}`;
      })
      .join("\n");

    const text =
      `Invite links\n\n${lines}\n\n` +
      "Share: t.me/test_bot?start=invite_<token>";
    const rows = list
      .filter((i) => i.activationStatus === "active")
      .slice(0, 5)
      .map((i) => [inlineButton(`Revoke ${i.token}`, `links:revoke:${i.token}`)]);
    rows.push([inlineButton("Create invite", "admin:inv_create:single")]);
    rows.push([inlineButton("Reusable invite", "admin:inv_create:multi")]);
    rows.push([inlineButton("Back to menu", "menu:main")]);
    const markup = inlineKeyboard(rows);
    if (edit) await ctx.editMessageText(text, { reply_markup: markup });
    else await ctx.reply(text, { reply_markup: markup });
    return;
  }

  // Regular subscriber
  const sub = await requireSubscriber(ctx);
  if (!sub) return;
  const text = copy.linksSubscriber(
    sub.inviteStatus === "active" ? "active" : "inactive",
    sub.activatedInviteToken,
  );
  const markup = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
  if (edit) await ctx.editMessageText(text, { reply_markup: markup });
  else await ctx.reply(text, { reply_markup: markup });
  void user;
}

composer.command("links", async (ctx) => {
  await showLinks(ctx, false);
});

composer.callbackQuery("links:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showLinks(ctx, true);
});

composer.callbackQuery(/^links:revoke:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (userId == null) return;
  if (!(await userIsOwner(userId))) {
    await ctx.reply("Owner tools are limited to the bot owner.");
    return;
  }
  const token = ctx.match![1]!;
  const inv = await getInvite(token);
  if (!inv) {
    await ctx.editMessageText("Couldn't find that invite.", {
      reply_markup: inlineKeyboard([[inlineButton("Back", "links:show")]]),
    });
    return;
  }
  inv.activationStatus = "revoked";
  await saveInvite(inv);
  await ctx.editMessageText(`Invite ${token} revoked.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("Invite list", "links:show")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

export default composer;
