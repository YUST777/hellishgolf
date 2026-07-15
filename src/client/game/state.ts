import type Phaser from "phaser";
import type { RuntimeMap, TiledMapJson } from "../../shared/tiled";
import type { InitResponse } from "../../shared/types";
import { loadPowerupState, type PowerupKind } from "./powerups";

/**
 * Mutable client-session state shared by the DOM shell modules (HUD, shop,
 * leaderboard, session). Kept in one plain object so each module reads the
 * live value instead of a stale import-time copy.
 */
export const ctx = {
  game: null as Phaser.Game | null,
  init: null as InitResponse | null,
  runtimeMap: null as RuntimeMap | null,
  powerups: loadPowerupState(),
  activePowerup: null as PowerupKind | null,
  accountBackedPlayer: false,
  economyRequestPending: false,
};

/** Handshake object exposed by `public/game/boot-preview.js`. */
export type BootPreviewBridge = {
  initPromise?: Promise<InitResponse>;
  mapPromise?: Promise<TiledMapJson>;
  mapId?: number;
  fail?: (message: string) => void;
};

export function bootPreview(): BootPreviewBridge | undefined {
  return (window as typeof window & { __hellishGolfBoot?: BootPreviewBridge })
    .__hellishGolfBoot;
}
