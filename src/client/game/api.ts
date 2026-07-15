import type {
  CollectCoinRequest,
  InitResponse,
  LeaderboardResponse,
  PlayerActionResponse,
  PowerupActionRequest,
  SkinActionRequest,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from "../../shared/types";
import { seedFromDateKey } from "../../shared/level";
import { pickMapId } from "../../shared/mapManifest";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await responseError(res, `GET ${url} failed`));
  return (await res.json()) as T;
}

async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message.trim();
    }
  } catch {
    // The response may be HTML or empty; use the status fallback below.
  }
  return `${fallback}: ${res.status}`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await responseError(res, `POST ${url} failed`));
  return (await res.json()) as T;
}

// --- Offline fallback -----------------------------------------------------
// When the game is served as a plain static site (e.g. Vercel) there is no
// Devvit server, so /api/* returns 404/HTML. We detect that and run fully
// client-side: pick the daily hole from the map pool by date, keep the best
// score in localStorage, and show an empty leaderboard.

const OFFLINE_BEST_KEY = "khg_offline_best";

function todayKeyUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Deterministic day index so everyone sees the same hole on a given date. */
function dailyMapId(dateKey: string): {
  mapId: number;
  holeNumber: number;
  seed: number;
} {
  const epoch = Date.UTC(2025, 0, 1);
  const day = Math.floor((Date.parse(dateKey) - epoch) / 86_400_000);
  const seed = seedFromDateKey(dateKey);
  return { mapId: pickMapId(seed), holeNumber: day + 1, seed };
}

function offlineBest(dateKey: string): number | null {
  try {
    const raw = JSON.parse(localStorage.getItem(OFFLINE_BEST_KEY) || "{}");
    return typeof raw[dateKey] === "number" ? raw[dateKey] : null;
  } catch {
    return null;
  }
}

function setOfflineBest(dateKey: string, strokes: number): number {
  const prev = offlineBest(dateKey);
  const best = prev == null ? strokes : Math.min(prev, strokes);
  try {
    const raw = JSON.parse(localStorage.getItem(OFFLINE_BEST_KEY) || "{}");
    raw[dateKey] = best;
    localStorage.setItem(OFFLINE_BEST_KEY, JSON.stringify(raw));
  } catch {
    /* ignore storage errors */
  }
  return best;
}

let offlineMode = false;

function offlineInit(): InitResponse {
  const dateKey = todayKeyUTC();
  const { mapId, holeNumber, seed } = dailyMapId(dateKey);
  return {
    postId: "offline",
    accountId: null,
    username: null,
    daily: { dateKey, holeNumber, seed, mapId },
    bestToday: offlineBest(dateKey),
    streak: 0,
    mapId,
    player: null,
  };
}

export const apiClient = {
  async init(): Promise<InitResponse> {
    try {
      return await getJson<InitResponse>("/api/init");
    } catch {
      offlineMode = true;
      return offlineInit();
    }
  },

  async submitScore(payload: SubmitScoreRequest): Promise<SubmitScoreResponse> {
    if (!offlineMode) {
      try {
        return await postJson<SubmitScoreResponse>("/api/score", payload);
      } catch {
        offlineMode = true;
      }
    }
    const dateKey = todayKeyUTC();
    const previous = offlineBest(dateKey);
    const best = setOfflineBest(dateKey, payload.strokes);
    return {
      ok: true,
      bestToday: best,
      rank: 1,
      totalPlayers: 1,
      streak: 0,
      improved: previous == null || payload.strokes < previous,
    };
  },

  async leaderboard(): Promise<LeaderboardResponse> {
    if (!offlineMode) {
      try {
        return await getJson<LeaderboardResponse>("/api/leaderboard");
      } catch {
        offlineMode = true;
      }
    }
    return { entries: [], totalPlayers: 0, you: null };
  },

  collectCoin(payload: CollectCoinRequest): Promise<PlayerActionResponse> {
    return postJson<PlayerActionResponse>("/api/player/coin", payload);
  },

  buyPowerup(payload: PowerupActionRequest): Promise<PlayerActionResponse> {
    return postJson<PlayerActionResponse>("/api/player/powerup/buy", payload);
  },

  consumePowerup(payload: PowerupActionRequest): Promise<PlayerActionResponse> {
    return postJson<PlayerActionResponse>("/api/player/powerup/use", payload);
  },

  chooseSkin(payload: SkinActionRequest): Promise<PlayerActionResponse> {
    return postJson<PlayerActionResponse>("/api/player/skin", payload);
  },

  completeTutorial(): Promise<PlayerActionResponse> {
    return postJson<PlayerActionResponse>("/api/player/tutorial", {});
  },
};
