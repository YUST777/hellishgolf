import { Hono } from "hono";
import { context, realtime, reddit } from "@devvit/web/server";
import type {
  CollectCoinRequest,
  InitResponse,
  LeaderboardResponse,
  LiveFinishMessage,
  PlayerActionResponse,
  PowerupActionRequest,
  SkinActionRequest,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from "../../shared/types";
import { isPowerupKind } from "../../shared/economy";
import { getPostLevelInfo } from "../core/daily";
import {
  buyPlayerPowerup,
  choosePlayerSkin,
  collectPlayerCoin,
  completePlayerTutorial,
  consumePlayerPowerup,
  getPlayerState,
  isKnownSkin,
  isValidCoinId,
} from "../core/player";
import { getBest, getStreak, leaderboard, submitScore } from "../core/scoring";
import { registerSupabasePlayer } from "../core/supabase";

type ErrorResponse = { status: "error"; message: string };
const MAX_SCORE_TIME_MS = 86_400_000;

export const api = new Hono();

async function currentRedditPlayer() {
  const accountId = context.userId;
  const username = context.username ?? (await reddit.getCurrentUsername());
  if (!accountId || !username) {
    throw new Error("Must be logged in with Reddit to update player data");
  }
  return { accountId, username };
}

async function currentPlayerContext() {
  const { postId } = context;
  if (!postId) throw new Error("postId is required");
  const { accountId, username } = await currentRedditPlayer();
  const { daily, mapId } = await getPostLevelInfo(postId);
  return { accountId, username, daily, mapId };
}

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
    const accountId = context.userId ?? null;
    const username =
      context.username ?? (await reddit.getCurrentUsername()) ?? null;
    const { daily, mapId } = await getPostLevelInfo(postId);

    if (accountId && username) {
      await registerSupabasePlayer(accountId, username);
    }

    const [bestToday, streak, player] = await Promise.all([
      accountId && username
        ? getBest(daily.dateKey, postId, accountId, username)
        : Promise.resolve(null),
      accountId ? getStreak(accountId) : Promise.resolve(0),
      accountId
        ? getPlayerState(accountId, daily.dateKey, mapId)
        : Promise.resolve(null),
    ]);

    return c.json<InitResponse>({
      postId,
      accountId,
      username,
      daily,
      bestToday,
      streak,
      mapId,
      player,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown init error";
    console.error(`API /init error for ${postId}:`, error);
    return c.json<ErrorResponse>({ status: "error", message }, 400);
  }
});

api.post("/player/coin", async (c) => {
  try {
    const body = await c.req.json<CollectCoinRequest>();
    if (!isValidCoinId(body.coinId)) throw new Error("Invalid coin id");
    const { accountId, daily, mapId } = await currentPlayerContext();
    const player = await collectPlayerCoin({
      username: accountId,
      dateKey: daily.dateKey,
      mapId,
      coinId: body.coinId,
    });
    return c.json<PlayerActionResponse>({ ok: true, player });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown coin error";
    console.error("API /player/coin error:", error);
    return c.json<ErrorResponse>({ status: "error", message }, 400);
  }
});

api.post("/player/powerup/buy", async (c) => {
  try {
    const body = await c.req.json<PowerupActionRequest>();
    if (!isPowerupKind(body.kind)) throw new Error("Invalid powerup kind");
    const { accountId, daily, mapId } = await currentPlayerContext();
    const player = await buyPlayerPowerup({
      username: accountId,
      dateKey: daily.dateKey,
      mapId,
      kind: body.kind,
    });
    return c.json<PlayerActionResponse>({ ok: true, player });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown purchase error";
    console.error("API /player/powerup/buy error:", error);
    return c.json<ErrorResponse>({ status: "error", message }, 400);
  }
});

api.post("/player/powerup/use", async (c) => {
  try {
    const body = await c.req.json<PowerupActionRequest>();
    if (!isPowerupKind(body.kind)) throw new Error("Invalid powerup kind");
    const { accountId, daily, mapId } = await currentPlayerContext();
    const player = await consumePlayerPowerup({
      username: accountId,
      dateKey: daily.dateKey,
      mapId,
      kind: body.kind,
    });
    return c.json<PlayerActionResponse>({ ok: true, player });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown powerup error";
    console.error("API /player/powerup/use error:", error);
    return c.json<ErrorResponse>({ status: "error", message }, 400);
  }
});

api.post("/player/skin", async (c) => {
  try {
    const body = await c.req.json<SkinActionRequest>();
    if (!isKnownSkin(body.skinId)) throw new Error("Invalid skin id");
    const { accountId, daily, mapId } = await currentPlayerContext();
    const player = await choosePlayerSkin({
      username: accountId,
      dateKey: daily.dateKey,
      mapId,
      skinId: body.skinId,
    });
    return c.json<PlayerActionResponse>({ ok: true, player });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown skin error";
    console.error("API /player/skin error:", error);
    return c.json<ErrorResponse>({ status: "error", message }, 400);
  }
});

api.post("/player/tutorial", async (c) => {
  try {
    const { accountId, daily, mapId } = await currentPlayerContext();
    const player = await completePlayerTutorial({
      username: accountId,
      dateKey: daily.dateKey,
      mapId,
    });
    return c.json<PlayerActionResponse>({ ok: true, player });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown tutorial error";
    console.error("API /player/tutorial error:", error);
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
    const { accountId, username } = await currentRedditPlayer();

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
      accountId,
      username,
      mapId,
      strokes,
      timeMs,
      moves: body.moves,
    });

    // Announce the finish to everyone with this post open (best-effort).
    try {
      await realtime.send<LiveFinishMessage>(`finish_${postId}`, {
        type: "finish",
        accountId,
        username,
        strokes,
        timeMs,
        rank: result.rank,
      });
    } catch (error) {
      console.error("realtime finish broadcast failed:", error);
    }

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
    const accountId = context.userId ?? null;
    const username =
      context.username ?? (await reddit.getCurrentUsername()) ?? null;
    const { daily } = await getPostLevelInfo(postId);
    const board = await leaderboard({
      dateKey: daily.dateKey,
      postId,
      accountId,
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
