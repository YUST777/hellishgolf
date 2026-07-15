import Phaser from "phaser";
import confetti from "canvas-confetti";
import "./tutorial.css";
import { GameScene } from "./GameScene";
import {
  DAILY_RESET_HOUR_UTC,
  DEFAULT_ZOOM,
  INFURIATING_STORAGE_KEY,
  TILESET_URL,
  ZOOM_LEVELS,
  ZOOM_STORAGE_KEY,
} from "./config";
import { apiClient } from "./api";
import { ensureRapier } from "./physics";
import { sound } from "./sound";
import { mapUrl } from "../../shared/mapManifest";
import {
  parseTiledMap,
  type RuntimeMap,
  type TiledMapJson,
} from "../../shared/tiled";
import { TILESET } from "../../shared/tiles";
import type {
  InitResponse,
  LeaderboardResponse,
  ReplayMove,
} from "../../shared/types";
import {
  BALL_SKINS,
  POWERUP_NAMES,
  POWERUP_ORDER,
  POWERUP_PRICES,
  buyPowerup,
  buySkin,
  collectCoin,
  collectedCoinIds,
  completeTutorial,
  consumePowerup,
  equipSkin,
  grantCoins,
  applyPlayerState,
  loadPowerupState,
  savePowerupState,
  type BallSkinId,
  type PowerupKind,
} from "./powerups";

/** Read the persisted discrete zoom preference (defaults to 1). */
function readZoom(): number {
  const raw = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
  return (ZOOM_LEVELS as readonly number[]).includes(raw) ? raw : DEFAULT_ZOOM;
}

/** Read the persisted Infuriating Mode preference (checkpoints disabled). */
function readInfuriating(): boolean {
  return localStorage.getItem(INFURIATING_STORAGE_KEY) === "true";
}

/** Milliseconds until the next daily hole rollover at 05:00 UTC. */
function msUntilNextHole(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(DAILY_RESET_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

let countdownTimer: number | null = null;

/**
 * Client bootstrap. Fetches the post's hole (a real mirrored Tiled map) from
 * the server, loads the map JSON + tileset atlas, boots Phaser with GameScene,
 * and manages the HUD/overlays around the canvas.
 */

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

function textIfPresent(id: string, value: string) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

let game: Phaser.Game | null = null;
let init: InitResponse | null = null;
let runtimeMap: RuntimeMap | null = null;
let powerups = loadPowerupState();
let toastTimer: number | null = null;
let activePowerup: PowerupKind | null = null;
let accountBackedPlayer = false;
let economyRequestPending = false;
type ShopTab = "powerups" | "skins";
let activeShopTab: ShopTab = "powerups";

type BootPreviewBridge = {
  initPromise?: Promise<InitResponse>;
  mapPromise?: Promise<TiledMapJson>;
  mapId?: number;
  fail?: (message: string) => void;
};

function bootPreview(): BootPreviewBridge | undefined {
  return (window as typeof window & { __hellishGolfBoot?: BootPreviewBridge })
    .__hellishGolfBoot;
}

const POWERUP_DESCRIPTIONS: Record<PowerupKind, string> = {
  trajectory: "Aim preview for one shot.",
  sticky: "Place slime on a wall.",
  checkpoint: "Create one safe return flag.",
};

function setHud(strokes: number, best: number | null, streak: number) {
  el("hud-strokes").textContent = String(strokes);
  el("hud-best").textContent = best == null ? "-" : String(best);
  const streakNode = el("hud-streak");
  streakNode.classList.toggle("hot", streak > 0);
  el("hud-streak-count").textContent = streak > 0 ? String(streak) : "-";
}

function toast(message: string) {
  const node = el("toast");
  node.textContent = message;
  node.classList.add("show");
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("show"), 1500);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function syncPlayerState(player: NonNullable<InitResponse["player"]>) {
  if (!init) return;
  applyPlayerState(powerups, player, init.daily.dateKey, init.mapId);
  updatePowerupHud();
}

function updatePowerupHud() {
  textIfPresent("wallet-coins", String(powerups.coins));
  textIfPresent("shop-coin-badge", String(powerups.coins));
  textIfPresent("shop-wallet-coins", String(powerups.coins));
  for (const kind of POWERUP_ORDER) {
    const count = powerups.inventory[kind];
    const canUse = count > 0;
    const isActive = activePowerup === kind;
    const showQuickUse = canUse || isActive;
    const button = document.querySelector<HTMLButtonElement>(
      `.powerup-btn[data-powerup="${kind}"]`,
    );
    const countNode = document.getElementById(`powerup-${kind}-count`);
    const actionNode = document.getElementById(`powerup-${kind}-action`);
    if (countNode) countNode.textContent = `x${count}`;
    if (actionNode) actionNode.textContent = isActive ? "READY" : "USE";
    if (button) {
      button.hidden = !showQuickUse;
      button.classList.toggle("can-use", canUse);
      button.classList.toggle("empty", count === 0);
      button.classList.toggle("active", isActive);
      button.disabled = !canUse && !isActive;
      button.title = isActive
        ? `${POWERUP_NAMES[kind]} ready`
        : canUse
          ? `Use ${POWERUP_NAMES[kind]}`
          : `No ${POWERUP_NAMES[kind]} owned`;
      button.setAttribute("aria-label", button.title);
    }
  }
  updateShop();
}

function setActivePowerup(kind: PowerupKind | null) {
  activePowerup = kind;
  updatePowerupHud();
}

async function onCoinCollected(coinId: string) {
  if (!init) return;
  if (collectCoin(powerups, init.daily.dateKey, init.mapId, coinId)) {
    updatePowerupHud();
    toast("+1 coin");
  }
  if (!accountBackedPlayer) return;
  try {
    const response = await apiClient.collectCoin({ coinId });
    syncPlayerState(response.player);
  } catch (error) {
    console.error("coin sync failed", error);
    toast("Coin sync failed. Try again after reconnecting.");
  }
}

function requestPowerup(kind: PowerupKind) {
  if (activePowerup && activePowerup !== kind) {
    game?.events.emit("powerup-cancel");
    setActivePowerup(null);
  }
  if (powerups.inventory[kind] <= 0) {
    toast(`Buy ${POWERUP_NAMES[kind]} in the shop`);
    openShop("powerups");
    return;
  }
  game?.events.emit("powerup-request", kind);
}

function setShopTab(tab: ShopTab) {
  activeShopTab = tab;
  document
    .querySelectorAll<HTMLButtonElement>(".shop-tab")
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.shopTab === tab);
    });
  document.querySelectorAll<HTMLElement>(".shop-section").forEach((section) => {
    section.classList.toggle("hidden", section.id !== `shop-${tab}`);
  });
}

function openShop(tab: ShopTab = activeShopTab) {
  setShopTab(tab);
  updateShop();
  show("shop-overlay");
}

function updateShop() {
  textIfPresent("shop-wallet-coins", String(powerups.coins));
  textIfPresent("shop-coin-badge", String(powerups.coins));

  for (const kind of POWERUP_ORDER) {
    const price = POWERUP_PRICES[kind];
    const count = powerups.inventory[kind];
    const canBuy = powerups.coins >= price;
    const item = document.getElementById(`shop-powerup-${kind}`);
    const button = document.getElementById(
      `shop-buy-powerup-${kind}`,
    ) as HTMLButtonElement | null;
    const copy = item?.querySelector<HTMLParagraphElement>("p");
    textIfPresent(`shop-powerup-${kind}-owned`, `x${count} owned`);
    if (copy) copy.textContent = POWERUP_DESCRIPTIONS[kind];
    item?.classList.toggle("locked", !canBuy);
    if (button) {
      button.textContent = canBuy ? `BUY ${price}` : `NEED ${price}`;
      button.disabled = !canBuy;
      button.title = canBuy
        ? `Buy ${POWERUP_NAMES[kind]} for ${price} coins`
        : `Need ${price} coins for ${POWERUP_NAMES[kind]}`;
    }
  }

  for (const skin of BALL_SKINS) {
    const owned = powerups.skins.owned.includes(skin.id);
    const equipped = powerups.skins.equipped === skin.id;
    const canBuy = powerups.coins >= skin.price;
    const item = document.getElementById(`shop-skin-${skin.id}`);
    const button = document.getElementById(
      `shop-skin-${skin.id}-action`,
    ) as HTMLButtonElement | null;
    item?.classList.toggle("equipped", equipped);
    item?.classList.toggle("locked", !owned && !canBuy);
    textIfPresent(
      `shop-skin-${skin.id}-owned`,
      equipped ? "Equipped" : owned ? "Owned" : `${skin.price} coins`,
    );
    if (button) {
      button.textContent = equipped
        ? "EQUIPPED"
        : owned
          ? "EQUIP"
          : canBuy
            ? `BUY ${skin.price}`
            : `NEED ${skin.price}`;
      button.disabled = equipped || (!owned && !canBuy);
      button.classList.toggle("secondary", owned && !equipped);
      button.title = equipped
        ? `${skin.name} equipped`
        : owned
          ? `Equip ${skin.name}`
          : canBuy
            ? `Buy ${skin.name} for ${skin.price} coins`
            : `Need ${skin.price} coins for ${skin.name}`;
    }
  }
}

async function buyPowerupFromShop(kind: PowerupKind) {
  if (economyRequestPending) return;
  if (powerups.coins < POWERUP_PRICES[kind]) {
    toast(`Need ${POWERUP_PRICES[kind]} coins`);
    return;
  }

  if (!accountBackedPlayer) {
    if (buyPowerup(powerups, kind)) {
      updatePowerupHud();
      toast(`${POWERUP_NAMES[kind]} bought`);
    }
    return;
  }

  economyRequestPending = true;
  try {
    const response = await apiClient.buyPowerup({ kind });
    syncPlayerState(response.player);
    toast(`${POWERUP_NAMES[kind]} bought`);
  } catch (error) {
    console.error("powerup purchase failed", error);
    toast(errorMessage(error, "Purchase failed. Try again."));
  } finally {
    economyRequestPending = false;
  }
}

async function chooseSkin(skinId: BallSkinId) {
  const skin = BALL_SKINS.find((item) => item.id === skinId);
  if (!skin) return;
  const owned = powerups.skins.owned.includes(skinId);
  if (!owned && powerups.coins < skin.price) {
    toast(`Need ${skin.price} coins`);
    return;
  }

  if (economyRequestPending) return;
  if (accountBackedPlayer) {
    economyRequestPending = true;
    try {
      const response = await apiClient.chooseSkin({ skinId });
      syncPlayerState(response.player);
      toast(owned ? `${skin.name} equipped` : `${skin.name} bought`);
    } catch (error) {
      console.error("skin update failed", error);
      toast(errorMessage(error, "Skin update failed. Try again."));
      return;
    } finally {
      economyRequestPending = false;
    }
  } else if (owned) {
    if (!equipSkin(powerups, skinId)) return;
    toast(`${skin.name} equipped`);
  } else if (buySkin(powerups, skinId)) {
    toast(`${skin.name} bought`);
  }
  game?.events.emit("skin-changed", powerups.skins.equipped);
  updatePowerupHud();
}

function canUseTestCoins(data?: InitResponse): boolean {
  return (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "::1" ||
    location.hostname === "[::1]" ||
    data?.postId === "preview_post"
  );
}

function applyTestCoinsFromUrl(data: InitResponse) {
  if (!canUseTestCoins(data)) return;
  const raw = new URLSearchParams(location.search).get("testcoins");
  if (!raw) return;
  const target = Math.max(0, Math.min(999, Math.floor(Number(raw) || 0)));
  if (target > powerups.coins) {
    powerups.coins = target;
    savePowerupState(powerups);
  }
}

function grantTestCoins() {
  if (!canUseTestCoins(init ?? undefined)) return;
  grantCoins(powerups, 50);
  updatePowerupHud();
  toast("+50 test coins");
}

/** Load the raw Tiled JSON for a map id and parse it into the runtime model. */
async function loadMap(mapId: number): Promise<RuntimeMap> {
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
  const dateKey = init?.daily.dateKey ?? "";
  const mapId = init?.mapId ?? 0;
  return {
    map: runtimeMap!,
    dateKey,
    mapId,
    collectedCoinIds: collectedCoinIds(powerups, dateKey, mapId),
    ballSkin: powerups.skins.equipped,
    zoom: readZoom(),
    infuriating: readInfuriating(),
    onStroke: (n: number) =>
      setHud(n, init?.bestToday ?? null, init?.streak ?? 0),
    // The checkpoint banner is driven by the 'checkpoint-reached' scene event.
    onCheckpoint: () => {},
    onCoinCollected: (coinId: string) => void onCoinCollected(coinId),
    onFinish: (strokes: number, timeMs: number, moves: ReplayMove[]) =>
      onFinish(strokes, timeMs, moves),
  };
}

function startGame(data: InitResponse, map: RuntimeMap) {
  init = data;
  runtimeMap = map;

  setHud(0, data.bestToday, data.streak);
  updatePowerupHud();
  el("hole-number").textContent = `#${data.daily.holeNumber}`;
  el("hole-date").textContent = data.daily.dateKey;

  game = new Phaser.Game({
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
        this.load.image("coin", "game/textures/coin.png");
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
    if (init) {
      init.bestToday = res.bestToday;
      init.streak = res.streak;
    }
    setHud(strokes, res.bestToday, res.streak);
    showResult(strokes, timeMs, res.rank, res.totalPlayers);
    void loadLeaderboard();
  } catch (err) {
    console.error("score submit failed", err);
  }
}

function launchWinConfetti() {
  const common = {
    disableForReducedMotion: true,
    scalar: 1.1,
    ticks: 180,
    zIndex: 1000,
  } as const;

  void confetti({
    ...common,
    particleCount: 90,
    spread: 70,
    origin: { x: 0.5, y: 0.62 },
  });

  window.setTimeout(() => {
    void confetti({
      ...common,
      particleCount: 55,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.76 },
    });
    void confetti({
      ...common,
      particleCount: 55,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.76 },
    });
  }, 140);
}

function showResult(
  strokes: number,
  timeMs: number,
  rank: number | null,
  total: number | null,
) {
  const overlay = el("result-overlay");
  overlay.classList.remove("hidden");
  el("result-strokes").textContent = String(strokes);
  el("result-time").textContent = `${(timeMs / 1000).toFixed(1)}s`;
  el("result-rank").textContent =
    rank && total ? `Rank ${rank} of ${total}` : "Submitting...";
  startCountdown();
}

/** Live "New hole in HH:MM:SS" countdown on the result modal. */
function startCountdown() {
  const tick = () => {
    let ms = msUntilNextHole();
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    el("result-countdown").textContent = `${hh}:${mm}:${ss}`;
  };
  tick();
  if (countdownTimer !== null) window.clearInterval(countdownTimer);
  countdownTimer = window.setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function createLeaderboardRow(
  entry: LeaderboardResponse["entries"][number],
  currentUsername: string | null,
  labelAsYou = false,
): HTMLLIElement {
  const li = document.createElement("li");
  const isYou = Boolean(currentUsername && currentUsername === entry.username);
  li.className = isYou ? "leaderboard-entry you" : "leaderboard-entry";

  const rank = document.createElement("span");
  rank.className = "leaderboard-rank";
  rank.textContent = String(entry.rank);

  const name = document.createElement("span");
  name.className = "leaderboard-username";
  name.textContent = `u/${entry.username}${labelAsYou ? " (you)" : ""}`;

  const score = document.createElement("span");
  score.className = "leaderboard-score";
  score.textContent = String(entry.strokes);

  li.append(rank, name, score);
  return li;
}

async function loadLeaderboard() {
  try {
    const lb: LeaderboardResponse = await apiClient.leaderboard();
    const list = el("leaderboard-list");
    list.replaceChildren();
    if (lb.entries.length === 0) {
      const li = document.createElement("li");
      li.className = "lb-empty";
      li.textContent = "Be the first to finish today!";
      list.appendChild(li);
    }
    for (const e of lb.entries) {
      list.appendChild(createLeaderboardRow(e, lb.you?.username ?? null));
    }
    el("lb-total").textContent = `${lb.totalPlayers} players today`;
    if (lb.you && !lb.entries.some((e) => e.username === lb.you!.username)) {
      list.appendChild(createLeaderboardRow(lb.you, lb.you.username, true));
    }
  } catch (err) {
    console.error("leaderboard load failed", err);
  }
}

function show(id: string) {
  el(id).classList.remove("hidden");
}
function hide(id: string) {
  el(id).classList.add("hidden");
}

function dismissQuickGuide() {
  el<HTMLElement>("quick-guide").hidden = true;
  if (powerups.tutorialComplete) return;

  completeTutorial(powerups);
  updatePowerupHud();
  if (!accountBackedPlayer) return;

  void apiClient
    .completeTutorial()
    .then((response) => syncPlayerState(response.player))
    .catch((error) => console.error("tutorial sync failed", error));
}

function showQuickGuide(force = false) {
  if (!game || !init) return;
  if (!force && powerups.tutorialComplete) return;

  hide("menu-overlay");
  el<HTMLElement>("quick-guide").hidden = false;
  window.requestAnimationFrame(() =>
    el<HTMLButtonElement>("quick-guide-done").focus(),
  );
}

function retry() {
  game?.events.emit("powerup-cancel");
  setActivePowerup(null);
  hide("result-overlay");
  hide("menu-overlay");
  hide("shop-overlay");
  hide("reset-overlay");
  stopCountdown();
  el("return-button").classList.remove("show");
  if (game && init && runtimeMap) {
    game.scene.stop("game");
    game.scene.start("game", sceneData());
  }
}

/** Reflect Infuriating Mode on the settings button and the title fire badge. */
function paintInfuriating() {
  const on = readInfuriating();
  const btn = document.getElementById("settings-infuriating");
  if (btn) btn.textContent = on ? "On" : "Off";
  const badge = document.getElementById("infuriating-badge");
  if (badge) badge.style.display = on ? "inline" : "none";
}

function toggleInfuriating() {
  const next = !readInfuriating();
  localStorage.setItem(INFURIATING_STORAGE_KEY, String(next));
  paintInfuriating();
  // Restart the hole so the checkpoint change takes effect immediately.
  retry();
}

/** Reflect the current mute state onto both the HUD icon and settings button. */
function paintSound() {
  const muted = sound.isMuted();
  const muteBtn = el("btn-mute");
  muteBtn.classList.toggle("is-muted", muted);
  muteBtn.title = muted ? "Sound off" : "Sound on";
  muteBtn.setAttribute("aria-label", muted ? "Sound off" : "Sound on");
  const sBtn = document.getElementById("settings-sound");
  if (sBtn) sBtn.textContent = muted ? "Off" : "On";
}

/** Highlight the active discrete zoom choice in Settings. */
function paintZoomChoices() {
  const current = readZoom();
  el("zoom-choices")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.zoom) === current);
    });
}

function toggleSound() {
  sound.init();
  sound.setMuted(!sound.isMuted());
  paintSound();
}

function openLeaderboard() {
  show("leaderboard-overlay");
  void loadLeaderboard();
}

function wireUi() {
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
    game?.events.emit("return-checkpoint");
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
        game?.events.emit("zoom-set", z);
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
    game?.events.emit("return-checkpoint"),
  );

  // Zoom controls forward to the scene.
  el("btn-zoom-in").addEventListener("click", () =>
    game?.events.emit("zoom-in"),
  );
  el("btn-zoom-out").addEventListener("click", () =>
    game?.events.emit("zoom-out"),
  );

  // Mute toggle.
  paintSound();
  el("btn-mute").addEventListener("click", toggleSound);

  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "c" || !canUseTestCoins(init ?? undefined))
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
function wireGameEvents() {
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
    if (consumePowerup(powerups, kind)) updatePowerupHud();
    if (kind === "sticky") toast("Slime placed");
    else if (kind === "checkpoint") toast("Checkpoint created");
    if (accountBackedPlayer) {
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

async function main() {
  wireUi();
  try {
    // Load the Rapier engine (WASM) and the hole data in parallel.
    const earlyInit = bootPreview()?.initPromise;
    const [data] = await Promise.all([
      earlyInit ?? apiClient.init(),
      ensureRapier(),
    ]);
    powerups = loadPowerupState(data.accountId);
    accountBackedPlayer = Boolean(
      data.player &&
      data.postId !== "preview_post" &&
      data.postId !== "offline",
    );
    if (data.player) {
      applyPlayerState(powerups, data.player, data.daily.dateKey, data.mapId);
    }
    applyTestCoinsFromUrl(data);
    const map = await loadMap(data.mapId);
    startGame(data, map);
    wireGameEvents();
    void loadLeaderboard();
    window.setTimeout(() => showQuickGuide(), 650);
  } catch (err) {
    console.error("init failed", err);
    bootPreview()?.fail?.("Failed to load hole. Refresh to retry.");
  }
}

void main();
