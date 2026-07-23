import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import * as copy from "../lib/copy.js";

const composer = new Composer<Ctx>();

const backToMenu = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(copy.HELP_TEXT);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(copy.HELP_TEXT, { reply_markup: backToMenu });
});

export default composer;
