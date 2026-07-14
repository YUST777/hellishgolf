import { redis } from "@devvit/web/server";
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  ReplayMove,
  SubmitScoreResponse,
} from "../../shared/types";
import {
  getSupabaseBest,
  getSupabaseLeaderboard,
  isSupabaseConfigured,
  sanitizeReplayMoves,
  submitSupabaseScore,
} from "./supabase";

/**
 * Redis key design (siloed per subreddit install):
 *   lb:<dateKey>:<postId>       sorted set  member=username score=strokes (lower is better)
 *   time:<dateKey>:<postId>     hash        username -> best timeMs (tie-break/stats)
 *   streak:<username>           string      current daily streak count
 *   streak:last:<username>      string      last dateKey the user completed
 */

const lbKey = (dateKey: string, postId: string) => `lb:${dateKey}:${postId}`;
const timeKey = (dateKey: string, postId: string) =>
  `time:${dateKey}:${postId}`;
const streakKey = (username: string) => `streak:${username}`;
const streakLastKey = (username: string) => `streak:last:${username}`;

type RankedRedisEntry = LeaderboardEntry & { timeMs: number };

function prevDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

function parseStoredTime(value: string | null | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : Number.MAX_SAFE_INTEGER;
}

async function redisRankings(
  dateKey: string,
  postId: string,
): Promise<RankedRedisEntry[]> {
  const key = lbKey(dateKey, postId);
  const total = await redis.zCard(key);
  if (total <= 0) return [];

  const [scores, times] = await Promise.all([
    redis.zRange(key, 0, total - 1, { by: "rank" }),
    redis.hGetAll(timeKey(dateKey, postId)),
  ]);

  return scores
    .map((entry) => ({
      username: entry.member,
      strokes: entry.score,
      timeMs: parseStoredTime(times[entry.member]),
      rank: 0,
    }))
    .sort(
      (a, b) =>
        a.strokes - b.strokes ||
        a.timeMs - b.timeMs ||
        a.username.localeCompare(b.username),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
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
  username: string,
): Promise<number | null> {
  if (await isSupabaseConfigured()) {
    try {
      return await getSupabaseBest(dateKey, postId, username);
    } catch (error) {
      console.error("Supabase getBest failed; falling back to Redis:", error);
    }
  }

  const score = await redis.zScore(lbKey(dateKey, postId), username);
  return typeof score === "number" ? score : null;
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
  mapId: number;
  strokes: number;
  timeMs: number;
  moves?: ReplayMove[];
}): Promise<SubmitScoreResponse> {
  const { dateKey, postId, username, strokes, timeMs } = params;
  const moves = sanitizeReplayMoves(params.moves);
  const streak = await bumpStreak(username, dateKey);

  if (await isSupabaseConfigured()) {
    try {
      return await submitSupabaseScore({
        dateKey,
        postId,
        username,
        mapId: params.mapId,
        strokes,
        timeMs,
        streak,
        moves,
      });
    } catch (error) {
      console.error(
        "Supabase submitScore failed; falling back to Redis:",
        error,
      );
    }
  }

  const key = lbKey(dateKey, postId);

  const existing = await redis.zScore(key, username);
  const hadPrevious = typeof existing === "number";
  const existingTimeRaw = hadPrevious
    ? await redis.hGet(timeKey(dateKey, postId), username)
    : null;
  const existingTime = parseStoredTime(existingTimeRaw);
  const improved =
    !hadPrevious ||
    strokes < existing! ||
    (strokes === existing && timeMs < existingTime);

  if (improved) {
    await redis.zAdd(key, { member: username, score: strokes });
    await redis.hSet(timeKey(dateKey, postId), { [username]: String(timeMs) });
  }

  const bestToday = improved ? strokes : existing!;
  const rankings = await redisRankings(dateKey, postId);
  const you = rankings.find((entry) => entry.username === username);

  return {
    ok: true,
    bestToday,
    rank: you?.rank ?? rankings.length,
    totalPlayers: rankings.length,
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

  if (await isSupabaseConfigured()) {
    try {
      return await getSupabaseLeaderboard({ dateKey, postId, username, limit });
    } catch (error) {
      console.error(
        "Supabase leaderboard failed; falling back to Redis:",
        error,
      );
    }
  }
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rankings = await redisRankings(dateKey, postId);
  const totalPlayers = rankings.length;

  const entries: LeaderboardEntry[] = rankings
    .slice(0, safeLimit)
    .map(({ username, strokes, rank }) => ({ username, strokes, rank }));

  let you: LeaderboardEntry | null = null;
  if (username) {
    const entry = rankings.find((row) => row.username === username);
    if (entry) you = { username, strokes: entry.strokes, rank: entry.rank };
  }

  return { entries, totalPlayers, you };
}
