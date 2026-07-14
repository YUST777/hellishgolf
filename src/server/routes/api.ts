import { Hono } from "hono";
import { context, reddit } from "@devvit/web/server";
import type {
  InitResponse,
  LeaderboardResponse,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from "../../shared/types";
import { getPostLevelInfo } from "../core/daily";
import { getBest, getStreak, leaderboard, submitScore } from "../core/scoring";

type ErrorResponse = { status: "error"; message: string };
const MAX_SCORE_TIME_MS = 86_400_000;

export const api = new Hono();

/**
 * Bootstrap the webview: returns the player, the current daily/UGC hole for
 * this post, and the player's best + streak so the UI can render immediately.
 */
api.get("/init", async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: "error",
        message: "postId is required but missing from context",
      },
      400,
    );
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? null;
    const { daily, mapId } = await getPostLevelInfo(postId);

    const [bestToday, streak] = await Promise.all([
      username
        ? getBest(daily.dateKey, postId, username)
        : Promise.resolve(null),
      username ? getStreak(username) : Promise.resolve(0),
    ]);

    return c.json<InitResponse>({
      postId,
      username,
      daily,
      bestToday,
      streak,
      mapId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown init error";
    console.error(`API /init error for ${postId}:`, error);
    return c.json<ErrorResponse>({ status: "error", message }, 400);
  }
});

/** Submit a completed run. Keeps the player's best strokes for the day. */
api.post("/score", async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      { status: "error", message: "postId is required" },
      400,
    );
  }

  try {
    const username = await reddit.getCurrentUsername();
    if (!username) {
      return c.json<ErrorResponse>(
        { status: "error", message: "Must be logged in to submit a score" },
        401,
      );
    }

    const body = await c.req.json<SubmitScoreRequest>();
    const rawStrokes = Number(body.strokes);
    const rawTimeMs = Number(body.timeMs);
    const strokes = Number.isFinite(rawStrokes)
      ? Math.max(1, Math.min(999, Math.floor(rawStrokes)))
      : 999;
    const timeMs = Number.isFinite(rawTimeMs)
      ? Math.max(0, Math.min(MAX_SCORE_TIME_MS, Math.floor(rawTimeMs)))
      : 0;

    const { daily, mapId } = await getPostLevelInfo(postId);
    const result = await submitScore({
      dateKey: daily.dateKey,
      postId,
      username,
      mapId,
      strokes,
      timeMs,
      moves: body.moves,
    });

    return c.json<SubmitScoreResponse>(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown score error";
    console.error(`API /score error for ${postId}:`, error);
    return c.json<ErrorResponse>({ status: "error", message }, 400);
  }
});

/** Fetch today's leaderboard for this post plus the caller's own rank. */
api.get("/leaderboard", async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      { status: "error", message: "postId is required" },
      400,
    );
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? null;
    const { daily } = await getPostLevelInfo(postId);
    const board = await leaderboard({
      dateKey: daily.dateKey,
      postId,
      username,
    });
    return c.json<LeaderboardResponse>(board);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown leaderboard error";
    console.error(`API /leaderboard error for ${postId}:`, error);
    return c.json<ErrorResponse>({ status: "error", message }, 400);
  }
});
