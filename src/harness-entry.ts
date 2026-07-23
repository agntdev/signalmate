import { buildBot } from "./bot.js";
import { resetDomainStore } from "./lib/store.js";
import { setNow } from "./lib/clock.js";

// The Tests-gate harness imports THIS module and calls makeBot() with no args,
// replaying dialog specs tokenlessly (it fakes the Bot API transport — no real
// Telegram call is made). The token is a placeholder for replay. The agntdev-ci
// orchestrator points AGNTDEV_BOT_MODULE at the compiled dist/harness-entry.js.
//
// Domain store + clock are reset per makeBot() so each harness spec is isolated.
// Clock is frozen mid-morning UTC so the default 18:00 digest is not due during
// ordinary /start interactions (avoids incidental digest DMs in dialog specs).
export async function makeBot() {
  resetDomainStore();
  setNow(Date.UTC(2026, 6, 23, 10, 0, 0)); // 2026-07-23 10:00:00 UTC
  return buildBot(process.env.BOT_TOKEN ?? "harness-test-token");
}
