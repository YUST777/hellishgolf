import {
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

export {
  BALL_SKINS,
  DEFAULT_BALL_SKIN,
  MAX_COINS_PER_DAILY_MAP,
  POWERUP_NAMES,
  POWERUP_ORDER,
  POWERUP_PRICES,
  STARTER_POWERUP_COUNT,
  getBallSkin,
  isBallSkinId,
  isPowerupKind,
} from "../../shared/economy";
export type {
  BallSkinDefinition,
  BallSkinId,
  BallSkinInventory,
  PlayerEconomy,
  PlayerState,
  PowerupInventory,
  PowerupKind,
} from "../../shared/economy";

export interface PowerupState extends PlayerEconomy {
  collected: Record<string, string[]>;
  storageKey: string;
}

const STORAGE_KEY = "hellishgolf_player_v2";
const LEGACY_STORAGE_KEY = "khg_powerups_v1";

function storageKey(accountId?: string | null): string {
  const account = accountId?.trim().toLowerCase();
  return account ? `${STORAGE_KEY}:${account}` : `${STORAGE_KEY}:offline`;
}

export function coinCollectionKey(dateKey: string, mapId: number): string {
  return `${dateKey}:${mapId}`;
}

function starterState(key: string): PowerupState {
  return {
    ...createStarterEconomy(),
    collected: {},
    storageKey: key,
  };
}

export function loadPowerupState(accountId?: string | null): PowerupState {
  const key = storageKey(accountId);
  try {
    const current = localStorage.getItem(key);
    const legacy = accountId ? null : localStorage.getItem(LEGACY_STORAGE_KEY);
    const stored = current ?? legacy;
    if (!stored) return starterState(key);

    const raw = JSON.parse(stored) as Record<string, unknown>;
    const economy = normalizeEconomy(raw);
    return {
      ...economy,
      collected:
        raw.collected && typeof raw.collected === "object"
          ? (raw.collected as Record<string, string[]>)
          : {},
      storageKey: key,
    };
  } catch {
    return starterState(key);
  }
}

export function savePowerupState(state: PowerupState): void {
  const { storageKey: key, ...stored } = state;
  localStorage.setItem(key, JSON.stringify(stored));
}

export function applyPlayerState(
  state: PowerupState,
  player: PlayerState,
  dateKey: string,
  mapId: number,
): void {
  state.coins = player.coins;
  state.inventory = { ...player.inventory };
  state.skins = {
    owned: [...player.skins.owned],
    equipped: player.skins.equipped,
  };
  state.tutorialComplete = player.tutorialComplete;
  state.collected[coinCollectionKey(dateKey, mapId)] = [
    ...player.collectedCoinIds,
  ];
  savePowerupState(state);
}

export function completeTutorial(state: PowerupState): void {
  state.tutorialComplete = true;
  savePowerupState(state);
}

export function collectedCoinIds(
  state: PowerupState,
  dateKey: string,
  mapId: number,
): string[] {
  const value = state.collected[coinCollectionKey(dateKey, mapId)];
  return Array.isArray(value) ? value : [];
}

export function collectCoin(
  state: PowerupState,
  dateKey: string,
  mapId: number,
  coinId: string,
): boolean {
  const key = coinCollectionKey(dateKey, mapId);
  const ids = new Set(collectedCoinIds(state, dateKey, mapId));
  if (ids.has(coinId)) return false;
  ids.add(coinId);
  state.collected[key] = [...ids];
  state.coins += 1;
  savePowerupState(state);
  return true;
}

export function grantCoins(state: PowerupState, amount: number): number {
  const add = Math.max(0, Math.floor(amount));
  state.coins += add;
  savePowerupState(state);
  return state.coins;
}

export function buyPowerup(state: PowerupState, kind: PowerupKind): boolean {
  const price = POWERUP_PRICES[kind];
  if (state.coins < price) return false;
  state.coins -= price;
  state.inventory[kind] += 1;
  savePowerupState(state);
  return true;
}

export function buySkin(state: PowerupState, skinId: BallSkinId): boolean {
  const skin = getBallSkin(skinId);
  if (state.skins.owned.includes(skin.id)) return true;
  if (state.coins < skin.price) return false;
  state.coins -= skin.price;
  state.skins.owned.push(skin.id);
  state.skins.equipped = skin.id;
  savePowerupState(state);
  return true;
}

export function equipSkin(state: PowerupState, skinId: BallSkinId): boolean {
  if (!isBallSkinId(skinId) || !state.skins.owned.includes(skinId))
    return false;
  state.skins.equipped = skinId;
  savePowerupState(state);
  return true;
}

export function consumePowerup(
  state: PowerupState,
  kind: PowerupKind,
): boolean {
  if (state.inventory[kind] <= 0) return false;
  state.inventory[kind] -= 1;
  savePowerupState(state);
  return true;
}

export function resetToStarterState(state: PowerupState): void {
  const starter = createStarterEconomy();
  state.coins = starter.coins;
  state.inventory = starter.inventory;
  state.skins = starter.skins;
  state.tutorialComplete = starter.tutorialComplete;
  state.collected = {};
  savePowerupState(state);
}
