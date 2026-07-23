import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { confirmKeyboard, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { requireSubscriber } from "../lib/access.js";
import * as copy from "../lib/copy.js";
import { deleteUser } from "../lib/store.js";

const composer = new Composer<Ctx>();

async function ask(ctx: Ctx, edit: boolean): Promise<void> {
  const user = await requireSubscriber(ctx);
  if (!user) return;
  const text = copy.unsubscribeConfirm();
  const markup = confirmKeyboard("unsub", { yes: "Yes, unsubscribe", no: "Keep subscription" });
  if (edit) await ctx.editMessageText(text, { reply_markup: markup });
  else await ctx.reply(text, { reply_markup: markup });
}

composer.command("unsubscribe", async (ctx) => {
  await ask(ctx, false);
});

composer.callbackQuery("unsub:ask", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ask(ctx, true);
});

composer.callbackQuery("unsub:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = ctx.from?.id;
  if (id == null) return;
  await deleteUser(id);
  ctx.session.step = "idle";
  ctx.session.draftSignal = undefined;
  await ctx.editMessageText(copy.unsubscribed());
});

composer.callbackQuery("unsub:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Subscription kept. Open /start for the menu.", {
    reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
  });
});

export default composer;
