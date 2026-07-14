import type { DailyInfo } from '../../shared/types';
import { seedFromDateKey } from '../../shared/level';
import { pickMapId } from '../../shared/mapManifest';
import { redis } from '@devvit/web/server';

/** Launch date used to compute sequential hole numbers. */
const LAUNCH_DATE_UTC = Date.UTC(2026, 6, 1); // 2026-07-01
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the date key for "today". We roll the daily hole at 05:00 UTC
 * (≈ midnight EST) to match the reference game's cadence.
 */
export function currentDateKey(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Metadata for the current daily hole. */
export function getDailyInfo(now: Date = new Date()): DailyInfo {
  const dateKey = currentDateKey(now);
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayUtc = Date.UTC(y, m - 1, d);
  const holeNumber = Math.max(
    1,
    Math.round((dayUtc - LAUNCH_DATE_UTC) / MS_PER_DAY) + 1
  );
  const seed = seedFromDateKey(dateKey);
  return {
    dateKey,
    holeNumber,
    seed,
    mapId: pickMapId(seed),
  };
}

/**
 * Redis key mapping a post to a specific map id. Daily posts don't store
 * anything (they resolve to the live daily hole); scheduled/UGC posts save
 * their fixed map id here at creation time so the hole never changes.
 */
const postMapKey = (postId: string) => `post:${postId}:map`;

/** Persist a fixed map id for a snapshotted daily (or UGC) post. */
export async function setPostMap(postId: string, mapId: number): Promise<void> {
  await redis.set(postMapKey(postId), String(mapId | 0));
}

/**
 * Resolve the hole a given post should render. If the post has a stored map id
 * (a snapshotted daily), use it; otherwise fall back to the live daily.
 */
export async function getPostLevelInfo(
  postId: string
): Promise<{ daily: DailyInfo; mapId: number }> {
  const daily = getDailyInfo();
  const stored = await redis.get(postMapKey(postId));
  if (stored) {
    return { daily, mapId: Number(stored) | 0 };
  }
  return { daily, mapId: daily.mapId };
}
