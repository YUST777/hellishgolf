import type { Level, LevelFeature, LevelFeatureType } from './types';

/**
 * Small, fast, seedable PRNG (mulberry32). Deterministic across client/server
 * so a given seed always yields the same hole layout.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convert a YYYY-MM-DD date key to a stable numeric seed. */
export function seedFromDateKey(dateKey: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const GRID_COLS = 16;
export const GRID_ROWS = 40;

/**
 * Procedurally build a vertical golf hole. The player starts at the bottom
 * (tee) and must climb to the cup near the top using drag-to-shoot physics.
 *
 * Difficulty scales gently with the seed's low bits so daily holes vary.
 */
export function generateLevel(seed: number): Level {
  const rng = mulberry32(seed);
  const cols = GRID_COLS;
  const rows = GRID_ROWS;

  const features: LevelFeature[] = [];

  // Border walls (left + right) so the ball stays in the play field.
  for (let r = 0; r < rows; r++) {
    features.push({ type: 'wall', col: 0, row: r });
    features.push({ type: 'wall', col: cols - 1, row: r });
  }
  // Floor.
  for (let c = 0; c < cols; c++) {
    features.push({ type: 'wall', col: c, row: 0 });
  }

  const tee = { col: 2 + Math.floor(rng() * 3), row: 1 };

  // Build a series of platforms rising up the hole. Each "band" gets one
  // ledge the player can aim for, plus occasional hazards and a checkpoint.
  const bandHeight = 5;
  const bands = Math.floor((rows - 4) / bandHeight);
  let lastCol = tee.col;

  for (let b = 0; b < bands; b++) {
    const row = 3 + b * bandHeight + Math.floor(rng() * 2);
    const ledgeWidth = 3 + Math.floor(rng() * 4);
    // Alternate sides to force zig-zag climbing.
    const goRight = b % 2 === 0 ? rng() > 0.35 : rng() > 0.65;
    let startCol = goRight
      ? Math.min(cols - 2 - ledgeWidth, lastCol + 1 + Math.floor(rng() * 4))
      : Math.max(1, lastCol - 1 - ledgeWidth - Math.floor(rng() * 4));
    startCol = Math.max(1, Math.min(cols - 1 - ledgeWidth, startCol));

    for (let i = 0; i < ledgeWidth; i++) {
      features.push({ type: 'wall', col: startCol + i, row });
    }

    // Sometimes cap an end with a ramp for interesting bounces.
    if (rng() > 0.5) {
      const rampType: LevelFeatureType = goRight ? 'ramp-right' : 'ramp-left';
      const rampCol = goRight ? startCol + ledgeWidth : startCol - 1;
      if (rampCol > 0 && rampCol < cols - 1) {
        features.push({ type: rampType, col: rampCol, row: row + 1 });
      }
    }

    // Bouncer pad on some ledges.
    if (rng() > 0.7) {
      features.push({
        type: 'bouncer',
        col: startCol + Math.floor(rng() * ledgeWidth),
        row: row + 1,
      });
    }

    // Sand traps slow the ball; place above a ledge.
    if (rng() > 0.75) {
      features.push({
        type: 'sand',
        col: startCol + Math.floor(rng() * ledgeWidth),
        row: row + 1,
      });
    }

    // Floating hazard in the gap between bands.
    if (b > 0 && rng() > 0.6) {
      const hazCol = 2 + Math.floor(rng() * (cols - 4));
      features.push({ type: 'hazard', col: hazCol, row: row - 2 });
    }

    // Checkpoint roughly every other band, on the ledge.
    if (b > 0 && b % 2 === 1) {
      features.push({
        type: 'checkpoint',
        col: startCol + Math.floor(ledgeWidth / 2),
        row: row + 1,
      });
    }

    lastCol = startCol + Math.floor(ledgeWidth / 2);
  }

  const cup = {
    col: Math.max(2, Math.min(cols - 3, lastCol)),
    row: rows - 3,
  };

  return { seed, cols, rows, tee, cup, features };
}
