import Phaser from "phaser";
import { apiClient } from "./api";
import { TILESET_URL } from "./config";
import { el, hide } from "./dom";
import { GameScene } from "./GameScene";
import {
  onCoinCollected,
  setActivePowerup,
  setHud,
  updatePowerupHud,
} from "./hud";
import { loadLeaderboard } from "./leaderboard";
import { collectedCoinIds } from "./powerups";
import { launchWinConfetti, showResult, stopCountdown } from "./result";
import { readInfuriating, readZoom } from "./settings";
import { bootPreview, ctx } from "./state";
import { mapUrl } from "../../shared/mapManifest";
import { parseTiledMap, type RuntimeMap } from "../../shared/tiled";
import { TILESET } from "../../shared/tiles";
import type { InitResponse, ReplayMove } from "../../shared/types";

/**
 * Game session lifecycle: load the hole's Tiled map, boot Phaser with
 * GameScene, handle finishes, and restart the hole.
 */

/** Load the raw Tiled JSON for a map id and parse it into the runtime model. */
export async function loadMap(mapId: number): Promise<RuntimeMap> {
  const early = bootPreview();
  if (early?.mapPromise && early.mapId === mapId) {
    return parseTiledMap(await early.mapPromise);
  }
  const res = await fetch(mapUrl(mapId));
  if (!res.ok) throw new Error(`Failed to load map ${mapId}: ${res.status}`);
  const json = await res.json();
  return parseTiledMap(json);
}

function sceneData() {
  const dateKey = ctx.init?.daily.dateKey ?? "";
  const mapId = ctx.init?.mapId ?? 0;
  return {
    map: ctx.runtimeMap!,
    dateKey,
    mapId,
    collectedCoinIds: collectedCoinIds(ctx.powerups, dateKey, mapId),
    ballSkin: ctx.powerups.skins.equipped,
    zoom: readZoom(),
    infuriating: readInfuriating(),
    onStroke: (n: number) =>
      setHud(n, ctx.init?.bestToday ?? null, ctx.init?.streak ?? 0),
    // The checkpoint banner is driven by the 'checkpoint-reached' scene event.
    onCheckpoint: () => {},
    onCoinCollected: (coinId: string) => void onCoinCollected(coinId),
    onFinish: (strokes: number, timeMs: number, moves: ReplayMove[]) =>
      onFinish(strokes, timeMs, moves),
  };
}

export function startGame(data: InitResponse, map: RuntimeMap) {
  ctx.init = data;
  ctx.runtimeMap = map;

  setHud(0, data.bestToday, data.streak);
  updatePowerupHud();
  el("hole-number").textContent = `#${data.daily.holeNumber}`;
  el("hole-date").textContent = data.daily.dateKey;

  ctx.game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game-root",
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#1a0603",
    pixelArt: true,
    // Physics is the real Rapier engine, stepped manually inside GameScene.
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: new (class extends Phaser.Scene {
      constructor() {
        super("boot");
      }
      preload() {
        this.load.spritesheet("tileset", TILESET_URL, {
          frameWidth: TILESET.tileWidth,
          frameHeight: TILESET.tileHeight,
        });
        // Tiling checkerboard backdrop (mirrors the original's background).
        this.load.image("checkerboard", "game/textures/checkerboard.webp");
      }
      create() {
        this.scene.add("game", GameScene, true, sceneData());
      }
    })(),
  });
}

async function onFinish(strokes: number, timeMs: number, moves: ReplayMove[]) {
  launchWinConfetti();
  showResult(strokes, timeMs, null, null);
  try {
    const res = await apiClient.submitScore({ strokes, timeMs, moves });
    if (ctx.init) {
      ctx.init.bestToday = res.bestToday;
      ctx.init.streak = res.streak;
    }
    setHud(strokes, res.bestToday, res.streak);
    showResult(strokes, timeMs, res.rank, res.totalPlayers);
    void loadLeaderboard();
  } catch (err) {
    console.error("score submit failed", err);
  }
}

/** Restart the current hole from scratch (also used by Infuriating toggle). */
export function retry() {
  ctx.game?.events.emit("powerup-cancel");
  setActivePowerup(null);
  hide("result-overlay");
  hide("menu-overlay");
  hide("shop-overlay");
  hide("reset-overlay");
  stopCountdown();
  el("return-button").classList.remove("show");
  if (ctx.game && ctx.init && ctx.runtimeMap) {
    ctx.game.scene.stop("game");
    ctx.game.scene.start("game", sceneData());
  }
}
