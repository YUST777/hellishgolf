export type PowerupKind = 'trajectory' | 'sticky' | 'checkpoint';

export const POWERUP_ORDER: readonly PowerupKind[] = [
  'trajectory',
  'sticky',
  'checkpoint',
];

export const POWERUP_PRICES: Record<PowerupKind, number> = {
  trajectory: 3,
  sticky: 6,
  checkpoint: 10,
};

export const POWERUP_NAMES: Record<PowerupKind, string> = {
  trajectory: 'Trajectory',
  sticky: 'Sticky Slime',
  checkpoint: 'Checkpoint',
};

export type BallSkinId = 'classic' | 'ember' | 'slime' | 'gold';

export interface BallSkinDefinition {
  id: BallSkinId;
  name: string;
  price: number;
  body: number;
  highlight: number;
  dimple: number;
  outline: number;
}

export const DEFAULT_BALL_SKIN: BallSkinId = 'classic';

export const BALL_SKINS: readonly BallSkinDefinition[] = [
  {
    id: 'classic',
    name: 'Classic',
    price: 0,
    body: 0xffffff,
    highlight: 0xfff4e5,
    dimple: 0xe6e6e6,
    outline: 0x1a1a1a,
  },
  {
    id: 'ember',
    name: 'Ember',
    price: 18,
    body: 0xff6b1a,
    highlight: 0xfff1a6,
    dimple: 0x7c2d12,
    outline: 0x3b1206,
  },
  {
    id: 'slime',
    name: 'Slime',
    price: 22,
    body: 0x8fff95,
    highlight: 0xe7ffe7,
    dimple: 0x047857,
    outline: 0x052e16,
  },
  {
    id: 'gold',
    name: 'Gold',
    price: 35,
    body: 0xffd65a,
    highlight: 0xfff7c2,
    dimple: 0x8a4b0f,
    outline: 0x4a2c17,
  },
];

export type BallSkinInventory = {
  owned: BallSkinId[];
  equipped: BallSkinId;
};

export type PowerupInventory = Record<PowerupKind, number>;

export interface PowerupState {
  coins: number;
  inventory: PowerupInventory;
  skins: BallSkinInventory;
  collected: Record<string, string[]>;
}

const STORAGE_KEY = 'khg_powerups_v1';

export function coinCollectionKey(dateKey: string, mapId: number): string {
  return `${dateKey}:${mapId}`;
}

function emptyInventory(): PowerupInventory {
  return {
    trajectory: 0,
    sticky: 0,
    checkpoint: 0,
  };
}

function normalizeInventory(value: unknown): PowerupInventory {
  const raw = value && typeof value === 'object' ? value : {};
  const rec = raw as Record<string, unknown>;
  return {
    trajectory: Math.max(0, Math.floor(Number(rec.trajectory) || 0)),
    sticky: Math.max(0, Math.floor(Number(rec.sticky) || 0)),
    checkpoint: Math.max(0, Math.floor(Number(rec.checkpoint) || 0)),
  };
}

function isBallSkinId(value: unknown): value is BallSkinId {
  return BALL_SKINS.some((skin) => skin.id === value);
}

function normalizeSkins(value: unknown): BallSkinInventory {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const ownedRaw = Array.isArray(raw.owned) ? raw.owned : [];
  const owned = new Set<BallSkinId>([DEFAULT_BALL_SKIN]);
  for (const id of ownedRaw) {
    if (isBallSkinId(id)) owned.add(id);
  }
  const equipped = isBallSkinId(raw.equipped) && owned.has(raw.equipped)
    ? raw.equipped
    : DEFAULT_BALL_SKIN;
  return { owned: [...owned], equipped };
}

export function getBallSkin(id: unknown): BallSkinDefinition {
  return BALL_SKINS.find((skin) => skin.id === id) ?? BALL_SKINS[0]!;
}

export function loadPowerupState(): PowerupState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as {
      coins?: unknown;
      inventory?: unknown;
      skins?: unknown;
      collected?: unknown;
    };
    return {
      coins: Math.max(0, Math.floor(Number(raw.coins) || 0)),
      inventory: normalizeInventory(raw.inventory),
      skins: normalizeSkins(raw.skins),
      collected:
        raw.collected && typeof raw.collected === 'object'
          ? (raw.collected as Record<string, string[]>)
          : {},
    };
  } catch {
    return {
      coins: 0,
      inventory: emptyInventory(),
      skins: normalizeSkins(null),
      collected: {},
    };
  }
}

export function savePowerupState(state: PowerupState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function collectedCoinIds(
  state: PowerupState,
  dateKey: string,
  mapId: number
): string[] {
  const value = state.collected[coinCollectionKey(dateKey, mapId)];
  return Array.isArray(value) ? value : [];
}

export function collectCoin(
  state: PowerupState,
  dateKey: string,
  mapId: number,
  coinId: string
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
  if (!state.skins.owned.includes(skinId)) return false;
  state.skins.equipped = skinId;
  savePowerupState(state);
  return true;
}

export function consumePowerup(state: PowerupState, kind: PowerupKind): boolean {
  if (state.inventory[kind] <= 0) return false;
  state.inventory[kind] -= 1;
  savePowerupState(state);
  return true;
}
