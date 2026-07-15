import "./tutorial.css";
import { apiClient } from "./api";
import { setupInlineMode } from "./inlineMode";
import { loadLeaderboard } from "./leaderboard";
import { ensureRapier } from "./physics";
import { applyPlayerState, loadPowerupState } from "./powerups";
import { loadMap, startGame } from "./session";
import { bootPreview, ctx } from "./state";
import {
  applyTestCoinsFromUrl,
  showQuickGuide,
  wireGameEvents,
  wireUi,
} from "./wiring";

/**
 * Client bootstrap. Fetches the post's hole from the server, loads the map
 * JSON + tileset atlas, boots Phaser with GameScene, and hands the HUD /
 * overlays to the wiring module. Session state lives in `state.ts`; the
 * shell UI is split across `hud.ts`, `shop.ts`, `leaderboard.ts`,
 * `result.ts`, `settings.ts`, and `session.ts`.
 */
async function main() {
  const inline = setupInlineMode();
  wireUi();
  try {
    // Load the Rapier engine (WASM) and the hole data in parallel.
    const earlyInit = bootPreview()?.initPromise;
    const [data] = await Promise.all([
      earlyInit ?? apiClient.init(),
      ensureRapier(),
    ]);
    ctx.powerups = loadPowerupState(data.accountId);
    ctx.accountBackedPlayer = Boolean(
      data.player &&
      data.postId !== "preview_post" &&
      data.postId !== "offline",
    );
    if (data.player) {
      applyPlayerState(
        ctx.powerups,
        data.player,
        data.daily.dateKey,
        data.mapId,
      );
    }
    applyTestCoinsFromUrl(data);
    const map = await loadMap(data.mapId);
    startGame(data, map);
    wireGameEvents();
    void loadLeaderboard();
    // Don't interrupt the inline feed preview with the tutorial dialog.
    if (!inline) window.setTimeout(() => showQuickGuide(), 650);
  } catch (err) {
    console.error("init failed", err);
    bootPreview()?.fail?.("Failed to load hole. Refresh to retry.");
  }
}

void main();
