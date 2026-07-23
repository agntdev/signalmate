/**
 * Owner controls: create signals, manage invites, stats, digest, maintenance.
 * Reachable from main-menu buttons registered in start.ts.
 */

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { requireOwner } from "../lib/access.js";
import * as copy from "../lib/copy.js";
import {
  createInvite,
  createSignal,
  getConfig,
  getSubscriberIds,
  listInviteTokens,
  listSignalIds,
  setConfig,
} from "../lib/store.js";
import type { SignalAction } from "../lib/types.js";
import { broadcastSignal, forceSendDigest } from "../lib/delivery.js";
import { formatSignal } from "../lib/format.js";

const composer = new Composer<Ctx>();

type WizardStep =
  | "idle"
  | "sig_asset"
  | "sig_action"
  | "sig_price"
  | "sig_confidence"
  | "sig_notes"
  | "await_join_code";

function cancelRow() {
  return [inlineButton("Cancel", "admin:cancel")];
}

composer.callbackQuery("admin:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  ctx.session.draftSignal = undefined;
  await ctx.editMessageText("Cancelled. Open /start for the menu.", {
    reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
  });
});

// ── New signal wizard ────────────────────────────────────────────────

composer.callbackQuery("admin:signal", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  ctx.session.step = "sig_asset";
  ctx.session.draftSignal = {};
  await ctx.editMessageText("New signal — send the asset symbol (e.g. BTC, EURUSD).", {
    reply_markup: inlineKeyboard([cancelRow()]),
  });
});

composer.callbackQuery(/^admin:sig_action:(buy|sell)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  if (!ctx.session.draftSignal?.asset) {
    await ctx.editMessageText("Start again from New signal.", {
      reply_markup: inlineKeyboard([[inlineButton("New signal", "admin:signal")]]),
    });
    return;
  }
  const action = ctx.match![1] as SignalAction;
  ctx.session.draftSignal = { ...ctx.session.draftSignal, action };
  ctx.session.step = "sig_price";
  await ctx.editMessageText(`Action: ${action.toUpperCase()}.\n\nSend the price (e.g. 64250.5).`, {
    reply_markup: inlineKeyboard([cancelRow()]),
  });
});

composer.callbackQuery("admin:sig_skip_notes", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  ctx.session.draftSignal = { ...(ctx.session.draftSignal ?? {}), notes: "" };
  await publishDraft(ctx, true);
});

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step as WizardStep | undefined;
  if (!step || step === "idle" || step === "await_join_code") return next();
  if (step === "sig_action") {
    await ctx.reply("Tap Buy or Sell to continue.");
    return;
  }

  if (!(await requireOwner(ctx))) {
    ctx.session.step = "idle";
    return;
  }

  const text = ctx.message.text.trim();
  if (text.startsWith("/")) {
    ctx.session.step = "idle";
    ctx.session.draftSignal = undefined;
    return next();
  }

  if (step === "sig_asset") {
    ctx.session.draftSignal = { ...(ctx.session.draftSignal ?? {}), asset: text.toUpperCase() };
    ctx.session.step = "sig_action";
    await ctx.reply(`Asset: ${text.toUpperCase()}.\n\nChoose the action:`, {
      reply_markup: inlineKeyboard([
        [inlineButton("Buy", "admin:sig_action:buy"), inlineButton("Sell", "admin:sig_action:sell")],
        cancelRow(),
      ]),
    });
    return;
  }

  if (step === "sig_price") {
    if (!ctx.session.draftSignal?.action) {
      await ctx.reply("Tap Buy or Sell to continue.");
      return;
    }
    ctx.session.draftSignal = { ...ctx.session.draftSignal, price: text };
    ctx.session.step = "sig_confidence";
    await ctx.reply("Send confidence as a number 0–100.");
    return;
  }

  if (step === "sig_confidence") {
    const n = Number(text.replace("%", ""));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      await ctx.reply("Confidence must be a number from 0 to 100. Try again.");
      return;
    }
    ctx.session.draftSignal = { ...ctx.session.draftSignal, confidence: Math.round(n) };
    ctx.session.step = "sig_notes";
    await ctx.reply("Optional notes — send text, or tap Skip.", {
      reply_markup: inlineKeyboard([[inlineButton("Skip", "admin:sig_skip_notes")], cancelRow()]),
    });
    return;
  }

  if (step === "sig_notes") {
    ctx.session.draftSignal = { ...ctx.session.draftSignal, notes: text };
    await publishDraft(ctx, false);
    return;
  }

  return next();
});

async function publishDraft(ctx: Ctx, edited: boolean): Promise<void> {
  const d = ctx.session.draftSignal;
  ctx.session.step = "idle";
  ctx.session.draftSignal = undefined;
  if (!d?.asset || !d.action || !d.price || d.confidence == null) {
    const msg = "Signal incomplete — start again from New signal.";
    if (edited) await ctx.editMessageText(msg);
    else await ctx.reply(msg);
    return;
  }

  const cfg = await getConfig();
  const signal = await createSignal({
    asset: d.asset,
    action: d.action,
    price: d.price,
    confidence: d.confidence,
    notes: d.notes ?? "",
    source: "owner",
  });

  const body = formatSignal(signal);
  if (cfg.maintenance) {
    const text = copy.signalCreatedMaintenance(signal.id, signal.asset, signal.action) + "\n\n" + body;
    if (edited) {
      await ctx.editMessageText(text, {
        reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
      });
    } else {
      await ctx.reply(text, {
        reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
      });
    }
    return;
  }

  const kb = inlineKeyboard([
    [inlineButton("History", "hist:list")],
    [inlineButton("Mute alerts", "set:mute:on")],
  ]);
  await broadcastSignal(ctx.api, signal, kb);
  const text = copy.signalCreated(signal.id, signal.asset, signal.action) + "\n\n" + body;
  if (edited) {
    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
    });
  } else {
    await ctx.reply(text, {
      reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
    });
  }
}

// ── Invites ──────────────────────────────────────────────────────────

composer.callbackQuery("admin:invites", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  // Reuse links view for owners
  await ctx.editMessageText("Invite tools — create a single-use or reusable link.", {
    reply_markup: inlineKeyboard([
      [inlineButton("Create invite", "admin:inv_create:single")],
      [inlineButton("Reusable invite", "admin:inv_create:multi")],
      [inlineButton("Invite list", "links:show")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery(/^admin:inv_create:(single|multi)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  const single = ctx.match![1] === "single";
  const invite = await createInvite(ctx.from!.id, { singleUse: single });
  const kind = single ? "single-use" : "reusable";
  const link = `https://t.me/test_bot?start=invite_${invite.token}`;
  await ctx.editMessageText(
    `Invite created (${kind}).\n\n` +
      `Code: ${invite.token}\n` +
      `Link: ${link}\n\n` +
      "Share the link or code with the subscriber.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Create another", "admin:inv_create:single")],
        [inlineButton("Invite list", "links:show")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

// ── Stats ────────────────────────────────────────────────────────────

composer.callbackQuery("admin:stats", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  const subs = await getSubscriberIds();
  const invites = await listInviteTokens();
  const signals = await listSignalIds();
  // Count active only
  const { getActiveSubscribers } = await import("../lib/store.js");
  const active = (await getActiveSubscribers()).length;
  void subs;
  await ctx.editMessageText(copy.statsText(active, invites.length, signals.length), {
    reply_markup: inlineKeyboard([
      [inlineButton("Maintenance", "admin:maint")],
      [inlineButton("Digest defaults", "admin:defaults")],
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery("admin:maint", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  const cfg = await getConfig();
  await ctx.editMessageText(
    `Maintenance window is ${cfg.maintenance ? "ON" : "OFF"}.\n\n` +
      "When on, new signals are saved but not broadcast live.",
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton(cfg.maintenance ? "Turn off" : "Turn on", "admin:maint:toggle"),
        ],
        [inlineButton("Back", "admin:stats")],
      ]),
    },
  );
});

composer.callbackQuery("admin:maint:toggle", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  const cfg = await getConfig();
  const next = await setConfig({ maintenance: !cfg.maintenance });
  await ctx.editMessageText(
    `Maintenance is now ${next.maintenance ? "ON" : "OFF"}.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Back to stats", "admin:stats")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

composer.callbackQuery("admin:defaults", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  const cfg = await getConfig();
  await ctx.editMessageText(
    `Default digest time for new subscribers: ${String(cfg.defaultDigestHour).padStart(2, "0")}:${String(cfg.defaultDigestMinute).padStart(2, "0")}.\n\n` +
      "Pick a new default:",
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("09:00", "admin:def:9"),
          inlineButton("12:00", "admin:def:12"),
          inlineButton("18:00", "admin:def:18"),
          inlineButton("21:00", "admin:def:21"),
        ],
        [inlineButton("Back", "admin:stats")],
      ]),
    },
  );
});

composer.callbackQuery(/^admin:def:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx))) return;
  const hour = Number(ctx.match![1]);
  await setConfig({ defaultDigestHour: hour, defaultDigestMinute: 0 });
  await ctx.editMessageText(
    `Default digest time set to ${String(hour).padStart(2, "0")}:00 for new subscribers.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Back to stats", "admin:stats")],
        [inlineButton("Back to menu", "menu:main")],
      ]),
    },
  );
});

// ── Force digest ─────────────────────────────────────────────────────

composer.callbackQuery("admin:digest", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Sending digest…" });
  if (!(await requireOwner(ctx))) return;
  const result = await forceSendDigest(ctx.api);
  if (result.signalCount === 0 && result.recipients === 0) {
    await ctx.editMessageText(copy.digestEmpty(), {
      reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
    });
    return;
  }
  await ctx.editMessageText(copy.digestSent(result.signalCount, result.recipients), {
    reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
  });
});

export default composer;
