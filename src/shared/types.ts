/**
 * Shared types between the Devvit client (webview) and server (Hono endpoints).
 * All server endpoints live under /api/ and exchange these shapes.
 */

/** A single obstacle/feature placed in a hole. */
export type LevelFeatureType =
  | 'wall'
  | 'ramp-left'
  | 'ramp-right'
  | 'bouncer'
  | 'sand'
  | 'hazard'
  | 'checkpoint';

export interface LevelFeature {
  type: LevelFeatureType;
  /** Grid column (0-based). */
  col: number;
  /** Grid row (0-based, 0 = bottom where the tee sits). */
  row: number;
  /** Width in grid cells (defaults to 1). */
  w?: number;
  /** Height in grid cells (defaults to 1). */
  h?: number;
}

/** A fully described hole. Deterministic given `seed`. */
export interface Level {
  /** Deterministic seed the layout was generated from. */
  seed: number;
  /** Grid width in cells. */
  cols: number;
  /** Grid height in cells (tall vertical climb). */
  rows: number;
  /** Tee position in grid cells. */
  tee: { col: number; row: number };
  /** Cup/finish position in grid cells. */
  cup: { col: number; row: number };
  features: LevelFeature[];
}

/** Metadata for the current daily hole. */
export interface DailyInfo {
  /** e.g. "2026-07-12" */
  dateKey: string;
  /** Sequential hole number since launch. */
  holeNumber: number;
  seed: number;
  /** The real mirrored Tiled map id served for this day (e.g. 465). */
  mapId: number;
}

/** Info about the current player + post context. */
export interface InitResponse {
  postId: string;
  username: string | null;
  daily: DailyInfo;
  /** The player's best (lowest) stroke count today, if any. */
  bestToday: number | null;
  /** Current daily streak. */
  streak: number;
  /** Real Tiled map id for this post's hole (loaded client-side from JSON). */
  mapId: number;
}

export interface SubmitScoreRequest {
  strokes: number;
  /** Seconds taken, for tie-breaking / stats. */
  timeMs: number;
}

export interface SubmitScoreResponse {
  ok: boolean;
  bestToday: number;
  rank: number;
  totalPlayers: number;
  streak: number;
  improved: boolean;
}

export interface LeaderboardEntry {
  username: string;
  strokes: number;
  rank: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  totalPlayers: number;
  you: LeaderboardEntry | null;
}

/** Request to create a user-generated hole from a seed. */
export interface CreateHoleRequest {
  seed: number;
  title?: string;
}

export interface CreateHoleResponse {
  ok: boolean;
  postId?: string;
  error?: string;
}
