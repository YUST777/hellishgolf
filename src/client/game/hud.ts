import { apiClient } from "./api";
import { el, textIfPresent, toast } from "./dom";
import {
  applyPlayerState,
  collectCoin,
  POWERUP_NAMES,
  POWERUP_ORDER,
  type PowerupKind,
} from "./powerups";
import { openShop, updateShop } from "./shop";
import { ctx } from "./state";
import type { InitResponse } from "../../shared/types";

/** HUD strip: strokes / best / streak counters plus the powerup quick bar. */

export function setHud(strokes: number, best: number | null, streak: number) {
  el("hud-strokes").textContent = String(strokes);
  el("hud-best").textContent = best == null ? "-" : String(best);
  const streakNode = el("hud-streak");
  streakNode.classList.toggle("hot", streak > 0);
  el("hud-streak-count").textContent = streak > 0 ? String(streak) : "-";
}

/** Merge a fresh server player snapshot into local state and repaint. */
export function syncPlayerState(player: NonNullable<InitResponse["player"]>) {
  if (!ctx.init) return;
  applyPlayerState(
    ctx.powerups,
    player,
    ctx.init.daily.dateKey,
    ctx.init.mapId,
  );
  updatePowerupHud();
}

export function updatePowerupHud() {
  textIfPresent("wallet-coins", String(ctx.powerups.coins));
  textIfPresent("shop-coin-badge", String(ctx.powerups.coins));
  textIfPresent("shop-wallet-coins", String(ctx.powerups.coins));
  for (const kind of POWERUP_ORDER) {
    const count = ctx.powerups.inventory[kind];
    const canUse = count > 0;
    const isActive = ctx.activePowerup === kind;
    const showQuickUse = canUse || isActive;
    const button = document.querySelector<HTMLButtonElement>(
      `.powerup-btn[data-powerup="${kind}"]`,
    );
    const countNode = document.getElementById(`powerup-${kind}-count`);
    if (countNode) countNode.textContent = `x${count}`;
    if (button) {
      button.hidden = !showQuickUse;
      button.classList.toggle("can-use", canUse);
      button.classList.toggle("empty", count === 0);
      button.classList.toggle("active", isActive);
      button.disabled = !canUse && !isActive;
      button.title = isActive
        ? `${POWERUP_NAMES[kind]} armed — click to cancel`
        : canUse
          ? `Use ${POWERUP_NAMES[kind]}`
          : `No ${POWERUP_NAMES[kind]} owned`;
      button.setAttribute("aria-label", button.title);
    }
  }
  updateShop();
}

export function setActivePowerup(kind: PowerupKind | null) {
  ctx.activePowerup = kind;
  updatePowerupHud();
}

export async function onCoinCollected(coinId: string) {
  if (!ctx.init) return;
  if (
    collectCoin(ctx.powerups, ctx.init.daily.dateKey, ctx.init.mapId, coinId)
  ) {
    updatePowerupHud();
    toast("+1 coin");
  }
  if (!ctx.accountBackedPlayer) return;
  try {
    const response = await apiClient.collectCoin({ coinId });
    syncPlayerState(response.player);
  } catch (error) {
    console.error("coin sync failed", error);
    toast("Coin sync failed. Try again after reconnecting.");
  }
}

export function requestPowerup(kind: PowerupKind) {
  // Click-to-toggle: clicking the active powerup disarms it.
  if (ctx.activePowerup === kind) {
    ctx.game?.events.emit("powerup-cancel");
    setActivePowerup(null);
    return;
  }
  if (ctx.activePowerup) {
    ctx.game?.events.emit("powerup-cancel");
    setActivePowerup(null);
  }
  if (ctx.powerups.inventory[kind] <= 0) {
    toast(`Buy ${POWERUP_NAMES[kind]} in the shop`);
    openShop("powerups");
    return;
  }
  ctx.game?.events.emit("powerup-request", kind);
}
