import { apiClient } from "./api";
import { ZOOM_STORAGE_KEY } from "./config";
import { el, hide, show, toast } from "./dom";
import {
  requestPowerup,
  setActivePowerup,
  syncPlayerState,
  updatePowerupHud,
} from "./hud";
import { openLeaderboard } from "./leaderboard";
import {
  BALL_SKINS,
  completeTutorial,
  consumePowerup,
  grantCoins,
  POWERUP_ORDER,
  savePowerupState,
  type PowerupKind,
} from "./powerups";
import { retry } from "./session";
import {
  paintInfuriating,
  paintSound,
  paintZoomChoices,
  toggleInfuriating,
  toggleSound,
} from "./settings";
import { buyPowerupFromShop, chooseSkin, openShop, setShopTab } from "./shop";
import { sound } from "./sound";
import { ctx } from "./state";
import type { InitResponse } from "../../shared/types";

/** Wires every DOM shell control to its handler; scene events to the HUD. */

// --- Dev-only test coins (localhost / preview posts) -----------------------

function canUseTestCoins(data?: InitResponse): boolean {
  return (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "::1" ||
    location.hostname === "[::1]" ||
    data?.postId === "preview_post"
  );
}

export function applyTestCoinsFromUrl(data: InitResponse) {
  if (!canUseTestCoins(data)) return;
  const raw = new URLSearchParams(location.search).get("testcoins");
  if (!raw) return;
  const target = Math.max(0, Math.min(999, Math.floor(Number(raw) || 0)));
  if (target > ctx.powerups.coins) {
    ctx.powerups.coins = target;
    savePowerupState(ctx.powerups);
  }
}

function grantTestCoins() {
  if (!canUseTestCoins(ctx.init ?? undefined)) return;
  grantCoins(ctx.powerups, 50);
  updatePowerupHud();
  toast("+50 test coins");
}

// --- First-run How to Play card ---------------------------------------------

function dismissQuickGuide() {
  el<HTMLElement>("quick-guide").hidden = true;
  if (ctx.powerups.tutorialComplete) return;

  completeTutorial(ctx.powerups);
  updatePowerupHud();
  if (!ctx.accountBackedPlayer) return;

  void apiClient
    .completeTutorial()
    .then((response) => syncPlayerState(response.player))
    .catch((error) => console.error("tutorial sync failed", error));
}

export function showQuickGuide(force = false) {
  if (!ctx.game || !ctx.init) return;
  if (!force && ctx.powerups.tutorialComplete) return;

  hide("menu-overlay");
  el<HTMLElement>("quick-guide").hidden = false;
  window.requestAnimationFrame(() =>
    el<HTMLButtonElement>("quick-guide-done").focus(),
  );
}

// --- DOM control wiring ------------------------------------------------------

export function wireUi() {
  POWERUP_ORDER.forEach((kind) => {
    document
      .querySelector<HTMLButtonElement>(`.powerup-btn[data-powerup="${kind}"]`)
      ?.addEventListener("click", () => requestPowerup(kind));
    el<HTMLButtonElement>(`shop-buy-powerup-${kind}`).addEventListener(
      "click",
      () => void buyPowerupFromShop(kind),
    );
  });
  BALL_SKINS.forEach((skin) => {
    el<HTMLButtonElement>(`shop-skin-${skin.id}-action`).addEventListener(
      "click",
      () => void chooseSkin(skin.id),
    );
  });
  document
    .querySelectorAll<HTMLButtonElement>(".shop-tab")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.shopTab;
        if (tab === "powerups" || tab === "skins") setShopTab(tab);
      });
    });
  updatePowerupHud();

  // Result modal.
  el("btn-retry").addEventListener("click", retry);
  el("btn-result-leaderboard").addEventListener("click", openLeaderboard);

  // Menu.
  el("btn-shop").addEventListener("click", () => openShop());
  el("btn-shop-close").addEventListener("click", () => hide("shop-overlay"));
  el("btn-menu").addEventListener("click", () => {
    sound.play("Back", 0.5);
    show("menu-overlay");
  });
  el("btn-menu-close").addEventListener("click", () => hide("menu-overlay"));
  el("menu-resume").addEventListener("click", () => hide("menu-overlay"));
  el("menu-shop").addEventListener("click", () => {
    hide("menu-overlay");
    openShop();
  });
  el("menu-leaderboard").addEventListener("click", () => {
    hide("menu-overlay");
    openLeaderboard();
  });
  el("menu-tutorial").addEventListener("click", () => showQuickGuide(true));
  el("quick-guide-done").addEventListener("click", dismissQuickGuide);
  el("menu-settings").addEventListener("click", () => {
    hide("menu-overlay");
    paintZoomChoices();
    paintSound();
    paintInfuriating();
    show("settings-overlay");
  });
  el("menu-return").addEventListener("click", () => {
    hide("menu-overlay");
    ctx.game?.events.emit("return-checkpoint");
  });
  el("menu-reset").addEventListener("click", () => {
    hide("menu-overlay");
    show("reset-overlay");
  });

  // Reset confirmation.
  el("reset-confirm").addEventListener("click", retry);
  el("reset-cancel").addEventListener("click", () => hide("reset-overlay"));

  // Settings.
  el("btn-settings-close").addEventListener("click", () =>
    hide("settings-overlay"),
  );
  el("settings-sound").addEventListener("click", toggleSound);
  el("settings-infuriating").addEventListener("click", toggleInfuriating);
  el("zoom-choices")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => {
      b.addEventListener("click", () => {
        const z = Number(b.dataset.zoom);
        localStorage.setItem(ZOOM_STORAGE_KEY, String(z));
        ctx.game?.events.emit("zoom-set", z);
        paintZoomChoices();
      });
    });

  // Leaderboard modal.
  el("btn-leaderboard").addEventListener("click", openLeaderboard);
  el("btn-lb-close").addEventListener("click", () =>
    hide("leaderboard-overlay"),
  );

  // Return-to-checkpoint floating button.
  el("return-button").addEventListener("click", () =>
    ctx.game?.events.emit("return-checkpoint"),
  );

  // Zoom controls forward to the scene.
  el("btn-zoom-in").addEventListener("click", () =>
    ctx.game?.events.emit("zoom-in"),
  );
  el("btn-zoom-out").addEventListener("click", () =>
    ctx.game?.events.emit("zoom-out"),
  );

  // Mute toggle.
  paintSound();
  el("btn-mute").addEventListener("click", toggleSound);

  window.addEventListener("keydown", (event) => {
    if (
      event.key.toLowerCase() !== "c" ||
      !canUseTestCoins(ctx.init ?? undefined)
    )
      return;
    if (
      (event.target as HTMLElement | null)?.closest("input, textarea, select")
    )
      return;
    grantTestCoins();
  });

  // Reflect Infuriating Mode state on the title badge at startup.
  paintInfuriating();
}

/** Bridge scene events to the DOM shell once the game exists. */
export function wireGameEvents() {
  const game = ctx.game;
  if (!game) return;
  game.events.on("zoom-changed", (z: number) => {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(z));
    paintZoomChoices();
  });
  // Reveal the return button + banner once a checkpoint is reached.
  game.events.on("checkpoint-reached", () => {
    el("return-button").classList.add("show");
    const alert = el("checkpoint-alert");
    alert.classList.add("show");
    window.setTimeout(() => alert.classList.remove("show"), 1600);
  });
  game.events.on("powerup-consumed", (kind: PowerupKind) => {
    if (consumePowerup(ctx.powerups, kind)) updatePowerupHud();
    if (kind === "sticky") toast("Slime placed");
    else if (kind === "checkpoint") toast("Checkpoint created");
    if (ctx.accountBackedPlayer) {
      void apiClient
        .consumePowerup({ kind })
        .then((response) => syncPlayerState(response.player))
        .catch((error) => {
          console.error("powerup sync failed", error);
          toast("Power-up sync failed. Try again after reconnecting.");
        });
    }
  });
  game.events.on("powerup-ready", (message: string) => toast(message));
  game.events.on("powerup-failed", (message: string) => toast(message));
  game.events.on("powerup-armed", (kind: PowerupKind) =>
    setActivePowerup(kind),
  );
  game.events.on("powerup-disarmed", () => setActivePowerup(null));
}
