import { redis } from "@devvit/web/server";
import {
  BALL_SKINS,
  MAX_COINS_PER_DAILY_MAP,
  POWERUP_PRICES,
  createStarterEconomy,
  getBallSkin,
  isBallSkinId,
  normalizeEconomy,
  type BallSkinId,
  type PlayerEconomy,
  type PlayerState,
  type PowerupKind,
} from "../../shared/economy";

const PLAYER_VERSION = "v2";
const MAX_COIN_ID_LENGTH = 80;

function playerId(username: string): string {
  return encodeURIComponent(username.trim().toLowerCase());
}

function economyKey(username: string): string {
  return `player:${PLAYER_VERSION}:${playerId(username)}:economy`;
}

function collectedKey(
  username: string,
  dateKey: string,
  mapId: number,
): string {
  return `player:${PLAYER_VERSION}:${playerId(username)}:coins:${dateKey}:${mapId}`;
}

async function loadEconomy(username: string): Promise<PlayerEconomy> {
  const key = economyKey(username);
  const raw = await redis.get(key);
  if (!raw) {
    const starter = createStarterEconomy();
    await redis.set(key, JSON.stringify(starter));
    return starter;
  }

  try {
    return normalizeEconomy(JSON.parse(raw));
  } catch {
    const repaired = createStarterEconomy();
    await redis.set(key, JSON.stringify(repaired));
    return repaired;
  }
}

async function saveEconomy(
  username: string,
  economy: PlayerEconomy,
): Promise<void> {
  await redis.set(economyKey(username), JSON.stringify(economy));
}

async function loadCollectedCoinIds(
  username: string,
  dateKey: string,
  mapId: number,
): Promise<string[]> {
  const raw = await redis.get(collectedKey(username, dateKey, mapId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (id): id is string =>
            typeof id === "string" && id.length <= MAX_COIN_ID_LENGTH,
        )
      : [];
  } catch {
    return [];
  }
}

async function stateFor(
  username: string,
  dateKey: string,
  mapId: number,
  economy?: PlayerEconomy,
): Promise<PlayerState> {
  const [currentEconomy, collectedCoinIds] = await Promise.all([
    economy ?? loadEconomy(username),
    loadCollectedCoinIds(username, dateKey, mapId),
  ]);
  return { ...currentEconomy, collectedCoinIds };
}

export function isValidCoinId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_COIN_ID_LENGTH &&
    /^coin-\d+-\d+$/.test(value)
  );
}

export async function getPlayerState(
  username: string,
  dateKey: string,
  mapId: number,
): Promise<PlayerState> {
  return stateFor(username, dateKey, mapId);
}

export async function collectPlayerCoin(params: {
  username: string;
  dateKey: string;
  mapId: number;
  coinId: string;
}): Promise<PlayerState> {
  const { username, dateKey, mapId, coinId } = params;
  const key = collectedKey(username, dateKey, mapId);
  const collected = new Set(
    await loadCollectedCoinIds(username, dateKey, mapId),
  );
  const economy = await loadEconomy(username);

  if (!collected.has(coinId)) {
    if (collected.size >= MAX_COINS_PER_DAILY_MAP) {
      throw new Error("All coins for this daily map are already collected");
    }
    collected.add(coinId);
    economy.coins = Math.min(1_000_000, economy.coins + 1);
    await Promise.all([
      redis.set(key, JSON.stringify([...collected])),
      saveEconomy(username, economy),
    ]);
  }

  return { ...economy, collectedCoinIds: [...collected] };
}

export async function buyPlayerPowerup(params: {
  username: string;
  dateKey: string;
  mapId: number;
  kind: PowerupKind;
}): Promise<PlayerState> {
  const economy = await loadEconomy(params.username);
  const price = POWERUP_PRICES[params.kind];
  if (economy.coins < price) throw new Error(`Need ${price} coins`);
  economy.coins -= price;
  economy.inventory[params.kind] += 1;
  await saveEconomy(params.username, economy);
  return stateFor(params.username, params.dateKey, params.mapId, economy);
}

export async function consumePlayerPowerup(params: {
  username: string;
  dateKey: string;
  mapId: number;
  kind: PowerupKind;
}): Promise<PlayerState> {
  const economy = await loadEconomy(params.username);
  if (economy.inventory[params.kind] <= 0) {
    throw new Error(`No ${params.kind} powerups remaining`);
  }
  economy.inventory[params.kind] -= 1;
  await saveEconomy(params.username, economy);
  return stateFor(params.username, params.dateKey, params.mapId, economy);
}

export async function choosePlayerSkin(params: {
  username: string;
  dateKey: string;
  mapId: number;
  skinId: BallSkinId;
}): Promise<PlayerState> {
  const economy = await loadEconomy(params.username);
  const skin = getBallSkin(params.skinId);
  const owned = economy.skins.owned.includes(skin.id);

  if (!owned) {
    if (economy.coins < skin.price) throw new Error(`Need ${skin.price} coins`);
    economy.coins -= skin.price;
    economy.skins.owned.push(skin.id);
  }
  economy.skins.equipped = skin.id;
  await saveEconomy(params.username, economy);
  return stateFor(params.username, params.dateKey, params.mapId, economy);
}

export async function completePlayerTutorial(params: {
  username: string;
  dateKey: string;
  mapId: number;
}): Promise<PlayerState> {
  const economy = await loadEconomy(params.username);
  economy.tutorialComplete = true;
  await saveEconomy(params.username, economy);
  return stateFor(params.username, params.dateKey, params.mapId, economy);
}

export function isKnownSkin(value: unknown): value is BallSkinId {
  return isBallSkinId(value) && BALL_SKINS.some((skin) => skin.id === value);
}
