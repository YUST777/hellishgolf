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

export type PowerupInventory = Record<PowerupKind, number>;

export interface PowerupState {
  coins: number;
  inventory: PowerupInventory;
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

export function loadPowerupState(): PowerupState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as {
      coins?: unknown;
      inventory?: unknown;
      collected?: unknown;
    };
    return {
      coins: Math.max(0, Math.floor(Number(raw.coins) || 0)),
      inventory: normalizeInventory(raw.inventory),
      collected:
        raw.collected && typeof raw.collected === 'object'
          ? (raw.collected as Record<string, string[]>)
          : {},
    };
  } catch {
    return {
      coins: 0,
      inventory: emptyInventory(),
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

export function consumePowerup(state: PowerupState, kind: PowerupKind): boolean {
  if (state.inventory[kind] <= 0) return false;
  state.inventory[kind] -= 1;
  savePowerupState(state);
  return true;
}
