import { redis } from '@devvit/web/server';
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  SubmitScoreResponse,
} from '../../shared/types';

/**
 * Redis key design (siloed per subreddit install):
 *   lb:<dateKey>:<postId>       sorted set  member=username score=strokes (lower is better)
 *   time:<dateKey>:<postId>     hash        username -> best timeMs (tie-break/stats)
 *   streak:<username>           string      current daily streak count
 *   streak:last:<username>      string      last dateKey the user completed
 */

const lbKey = (dateKey: string, postId: string) => `lb:${dateKey}:${postId}`;
const timeKey = (dateKey: string, postId: string) => `time:${dateKey}:${postId}`;
const streakKey = (username: string) => `streak:${username}`;
const streakLastKey = (username: string) => `streak:last:${username}`;

function prevDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

/** Read the player's current streak count. */
export async function getStreak(username: string): Promise<number> {
  const raw = await redis.get(streakKey(username));
  return raw ? parseInt(raw, 10) : 0;
}

/** Read the player's best (lowest) strokes for a given day/post. */
export async function getBest(
  dateKey: string,
  postId: string,
  username: string
): Promise<number | null> {
  const score = await redis.zScore(lbKey(dateKey, postId), username);
  return typeof score === 'number' ? score : null;
}

/**
 * Update the daily streak on a completion. A streak increments only once per
 * day and only if the previous day was also completed; otherwise it resets to 1.
 */
async function bumpStreak(username: string, dateKey: string): Promise<number> {
  const last = await redis.get(streakLastKey(username));
  if (last === dateKey) {
    // Already counted today.
    return getStreak(username);
  }
  const prev = prevDateKey(dateKey);
  let streak: number;
  if (last === prev) {
    streak = (await getStreak(username)) + 1;
  } else {
    streak = 1;
  }
  await redis.set(streakKey(username), String(streak));
  await redis.set(streakLastKey(username), dateKey);
  return streak;
}

/** Submit a score; keeps only the player's best (lowest) strokes for the day. */
export async function submitScore(params: {
  dateKey: string;
  postId: string;
  username: string;
  strokes: number;
  timeMs: number;
}): Promise<SubmitScoreResponse> {
  const { dateKey, postId, username, strokes, timeMs } = params;
  const key = lbKey(dateKey, postId);

  const existing = await redis.zScore(key, username);
  const hadPrevious = typeof existing === 'number';
  const improved = !hadPrevious || strokes < existing!;

  if (improved) {
    await redis.zAdd(key, { member: username, score: strokes });
    await redis.hSet(timeKey(dateKey, postId), { [username]: String(timeMs) });
  }

  // Streaks count on any completion of the day's hole.
  const streak = await bumpStreak(username, dateKey);

  const bestToday = improved ? strokes : existing!;
  const rank = (await redis.zRank(key, username)) ?? 0;
  const totalPlayers = await redis.zCard(key);

  return {
    ok: true,
    bestToday,
    rank: rank + 1, // 1-based for display
    totalPlayers,
    streak,
    improved,
  };
}

/** Fetch the top N of the leaderboard plus the caller's own row. */
export async function leaderboard(params: {
  dateKey: string;
  postId: string;
  username: string | null;
  limit?: number;
}): Promise<LeaderboardResponse> {
  const { dateKey, postId, username, limit = 10 } = params;
  const key = lbKey(dateKey, postId);

  const totalPlayers = await redis.zCard(key);
  // Lowest strokes first == ranks 0..limit-1 by rank.
  const top = await redis.zRange(key, 0, limit - 1, { by: 'rank' });

  const entries: LeaderboardEntry[] = top.map((e, i) => ({
    username: e.member,
    strokes: e.score,
    rank: i + 1,
  }));

  let you: LeaderboardEntry | null = null;
  if (username) {
    const score = await redis.zScore(key, username);
    if (typeof score === 'number') {
      const rank = (await redis.zRank(key, username)) ?? 0;
      you = { username, strokes: score, rank: rank + 1 };
    }
  }

  return { entries, totalPlayers, you };
}
