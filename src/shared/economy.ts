export type PowerupKind = "trajectory" | "sticky" | "checkpoint";

export const POWERUP_ORDER: readonly PowerupKind[] = [
  "trajectory",
  "sticky",
  "checkpoint",
];

export const POWERUP_PRICES: Record<PowerupKind, number> = {
  trajectory: 3,
  sticky: 6,
  checkpoint: 10,
};

export const POWERUP_NAMES: Record<PowerupKind, string> = {
  trajectory: "Trajectory",
  sticky: "Sticky Slime",
  checkpoint: "Checkpoint",
};

export const STARTER_POWERUP_COUNT = 3;
export const MAX_COINS_PER_DAILY_MAP = 5;

export type BallSkinId = "classic" | "ember" | "slime" | "gold";

export interface BallSkinDefinition {
  id: BallSkinId;
  name: string;
  price: number;
  body: number;
  highlight: number;
  dimple: number;
  outline: number;
}

export const DEFAULT_BALL_SKIN: BallSkinId = "classic";

export const BALL_SKINS: readonly BallSkinDefinition[] = [
  {
    id: "classic",
    name: "Classic",
    price: 0,
    body: 0xffffff,
    highlight: 0xfff4e5,
    dimple: 0xe6e6e6,
    outline: 0x1a1a1a,
  },
  {
    id: "ember",
    name: "Ember",
    price: 18,
    body: 0xff6b1a,
    highlight: 0xfff1a6,
    dimple: 0x7c2d12,
    outline: 0x3b1206,
  },
  {
    id: "slime",
    name: "Slime",
    price: 22,
    body: 0x8fff95,
    highlight: 0xe7ffe7,
    dimple: 0x047857,
    outline: 0x052e16,
  },
  {
    id: "gold",
    name: "Gold",
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

export interface PlayerEconomy {
  coins: number;
  inventory: PowerupInventory;
  skins: BallSkinInventory;
  tutorialComplete: boolean;
}

export interface PlayerState extends PlayerEconomy {
  collectedCoinIds: string[];
}

function boundedWholeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1_000_000, Math.floor(parsed)));
}

export function isPowerupKind(value: unknown): value is PowerupKind {
  return POWERUP_ORDER.includes(value as PowerupKind);
}

export function isBallSkinId(value: unknown): value is BallSkinId {
  return BALL_SKINS.some((skin) => skin.id === value);
}

export function getBallSkin(id: unknown): BallSkinDefinition {
  return BALL_SKINS.find((skin) => skin.id === id) ?? BALL_SKINS[0]!;
}

export function createStarterEconomy(): PlayerEconomy {
  return {
    coins: 0,
    inventory: {
      trajectory: STARTER_POWERUP_COUNT,
      sticky: STARTER_POWERUP_COUNT,
      checkpoint: STARTER_POWERUP_COUNT,
    },
    skins: {
      owned: [DEFAULT_BALL_SKIN],
      equipped: DEFAULT_BALL_SKIN,
    },
    tutorialComplete: false,
  };
}

export function normalizeEconomy(value: unknown): PlayerEconomy {
  const fallback = createStarterEconomy();
  if (!value || typeof value !== "object") return fallback;

  const raw = value as Record<string, unknown>;
  const inventory =
    raw.inventory && typeof raw.inventory === "object"
      ? (raw.inventory as Record<string, unknown>)
      : {};
  const skins =
    raw.skins && typeof raw.skins === "object"
      ? (raw.skins as Record<string, unknown>)
      : {};
  const ownedRaw = Array.isArray(skins.owned) ? skins.owned : [];
  const owned = new Set<BallSkinId>([DEFAULT_BALL_SKIN]);
  for (const id of ownedRaw) {
    if (isBallSkinId(id)) owned.add(id);
  }
  const equipped =
    isBallSkinId(skins.equipped) && owned.has(skins.equipped)
      ? skins.equipped
      : DEFAULT_BALL_SKIN;

  return {
    coins: boundedWholeNumber(raw.coins),
    inventory: {
      trajectory: boundedWholeNumber(inventory.trajectory),
      sticky: boundedWholeNumber(inventory.sticky),
      checkpoint: boundedWholeNumber(inventory.checkpoint),
    },
    skins: { owned: [...owned], equipped },
    tutorialComplete: raw.tutorialComplete === true,
  };
}
