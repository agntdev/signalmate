/**
 * Role-aware main menu. Owner tools only appear for owners; strangers get a
 * minimal keyboard. Uses toolkit builders so markup matches harness expectations.
 */

import {
  inlineButton,
  inlineKeyboard,
  type InlineKeyboardMarkup,
} from "../toolkit/index.js";

export function subscriberMenu(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [inlineButton("History", "hist:list"), inlineButton("Settings", "set:main")],
    [inlineButton("Links", "links:show"), inlineButton("Help", "menu:help")],
    [inlineButton("Unsubscribe", "unsub:ask")],
  ]);
}

export function ownerMenu(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [inlineButton("History", "hist:list"), inlineButton("Settings", "set:main")],
    [inlineButton("New signal", "admin:signal"), inlineButton("Invites", "admin:invites")],
    [inlineButton("Stats", "admin:stats"), inlineButton("Send digest", "admin:digest")],
    [inlineButton("Links", "links:show"), inlineButton("Help", "menu:help")],
    [inlineButton("Unsubscribe", "unsub:ask")],
  ]);
}

export function strangerMenu(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [inlineButton("Enter code", "invite:code")],
    [inlineButton("Help", "menu:help")],
  ]);
}
