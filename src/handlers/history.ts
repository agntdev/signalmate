import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { requireSubscriber } from "../lib/access.js";
import * as copy from "../lib/copy.js";
import { getSignal, listRecentSignals } from "../lib/store.js";
import { formatSignal, formatSignalShort } from "../lib/format.js";

const composer = new Composer<Ctx>();

const PER_PAGE = 5;

function historyKeyboard(ids: string[], page: number) {
  const totalPages = Math.max(1, Math.ceil(ids.length / PER_PAGE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = ids.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
  const rows = slice.map((id) => [inlineButton(id, `hist:view:${id}`)]);
  const nav = [];
  if (p > 0) nav.push(inlineButton("Prev", `hist:page:${p - 1}`));
  if (p < totalPages - 1) nav.push(inlineButton("Next", `hist:page:${p + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([inlineButton("Back to menu", "menu:main")]);
  return inlineKeyboard(rows);
}

async function renderList(ctx: Ctx, page: number, edit: boolean): Promise<void> {
  const user = await requireSubscriber(ctx);
  if (!user) return;
  const signals = await listRecentSignals(50);
  if (signals.length === 0) {
    const text = copy.historyEmpty();
    const markup = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
    if (edit) await ctx.editMessageText(text, { reply_markup: markup });
    else await ctx.reply(text, { reply_markup: markup });
    return;
  }
  const ids = signals.map((s) => s.id);
  const lines = signals
    .slice(0, PER_PAGE)
    .map((s, i) => `${i + 1}. ${formatSignalShort(s)}`)
    .join("\n");
  // For pages > 0, re-slice
  const totalPages = Math.max(1, Math.ceil(ids.length / PER_PAGE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const pageSignals = signals.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
  const body = pageSignals.map((s, i) => `${p * PER_PAGE + i + 1}. ${formatSignalShort(s)}`).join("\n");
  void lines;
  const text = `Recent signals\n\n${body}\n\nTap a signal ID for details.`;
  const markup = historyKeyboard(ids, p);
  if (edit) await ctx.editMessageText(text, { reply_markup: markup });
  else await ctx.reply(text, { reply_markup: markup });
}

composer.command("history", async (ctx) => {
  await renderList(ctx, 0, false);
});

composer.callbackQuery("hist:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderList(ctx, 0, true);
});

composer.callbackQuery(/^hist:page:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = Number(ctx.match![1]);
  await renderList(ctx, page, true);
});

composer.callbackQuery(/^hist:view:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await requireSubscriber(ctx);
  if (!user) return;
  const id = ctx.match![1]!;
  const signal = await getSignal(id);
  if (!signal) {
    await ctx.editMessageText("Couldn't find that signal — it may have been removed.", {
      reply_markup: inlineKeyboard([[inlineButton("Back to history", "hist:list")]]),
    });
    return;
  }
  await ctx.editMessageText(formatSignal(signal), {
    reply_markup: inlineKeyboard([
      [inlineButton("Back to history", "hist:list")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

export default composer;
