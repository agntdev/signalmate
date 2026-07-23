import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { requireSubscriber } from "../lib/access.js";
import * as copy from "../lib/copy.js";
import { saveUser } from "../lib/store.js";

const composer = new Composer<Ctx>();

function settingsKeyboard(muted: boolean) {
  return inlineKeyboard([
    [
      inlineButton("09:00", "set:time:09:00"),
      inlineButton("12:00", "set:time:12:00"),
      inlineButton("18:00", "set:time:18:00"),
    ],
    [
      inlineButton("21:00", "set:time:21:00"),
      inlineButton(muted ? "Unmute alerts" : "Mute alerts", muted ? "set:mute:off" : "set:mute:on"),
    ],
    [
      inlineButton("UTC", "set:tz:UTC"),
      inlineButton("London", "set:tz:Europe/London"),
      inlineButton("New York", "set:tz:America/New_York"),
    ],
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

async function showSettings(ctx: Ctx, edit: boolean): Promise<void> {
  const user = await requireSubscriber(ctx);
  if (!user) return;
  const text = copy.settingsText(user.digestSchedule, user.notificationMute, user.timezone);
  const markup = settingsKeyboard(user.notificationMute);
  if (edit) await ctx.editMessageText(text, { reply_markup: markup });
  else await ctx.reply(text, { reply_markup: markup });
}

composer.command("settings", async (ctx) => {
  await showSettings(ctx, false);
});

composer.callbackQuery("set:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showSettings(ctx, true);
});

composer.callbackQuery(/^set:time:(\d{2}:\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await requireSubscriber(ctx);
  if (!user) return;
  const time = ctx.match![1]!;
  user.digestSchedule = time;
  await saveUser(user);
  await ctx.editMessageText(
    `Digest time set to ${time} (${user.timezone}).\n\n` +
      copy.settingsText(user.digestSchedule, user.notificationMute, user.timezone),
    { reply_markup: settingsKeyboard(user.notificationMute) },
  );
});

composer.callbackQuery(/^set:mute:(on|off)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await requireSubscriber(ctx);
  if (!user) return;
  user.notificationMute = ctx.match![1] === "on";
  await saveUser(user);
  await ctx.editMessageText(
    user.notificationMute
      ? "Live alerts muted. Digests still arrive.\n\n" +
          copy.settingsText(user.digestSchedule, user.notificationMute, user.timezone)
      : "Live alerts are on again.\n\n" +
          copy.settingsText(user.digestSchedule, user.notificationMute, user.timezone),
    { reply_markup: settingsKeyboard(user.notificationMute) },
  );
});

composer.callbackQuery(/^set:tz:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await requireSubscriber(ctx);
  if (!user) return;
  const tz = ctx.match![1]!;
  user.timezone = tz;
  await saveUser(user);
  await ctx.editMessageText(
    `Timezone set to ${tz}.\n\n` +
      copy.settingsText(user.digestSchedule, user.notificationMute, user.timezone),
    { reply_markup: settingsKeyboard(user.notificationMute) },
  );
});

export default composer;
