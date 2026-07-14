import type {
  InitResponse,
  LeaderboardResponse,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from '../../shared/types';
import { MAP_IDS } from '../../shared/mapManifest';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

// --- Offline fallback -----------------------------------------------------
// When the game is served as a plain static site (e.g. Vercel) there is no
// Devvit server, so /api/* returns 404/HTML. We detect that and run fully
// client-side: pick the daily hole from the map pool by date, keep the best
// score in localStorage, and show an empty leaderboard.

const OFFLINE_BEST_KEY = 'khg_offline_best';

function todayKeyUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Deterministic day index so everyone sees the same hole on a given date. */
function dailyMapId(dateKey: string): { mapId: number; holeNumber: number } {
  const epoch = Date.UTC(2025, 0, 1);
  const day = Math.floor((Date.parse(dateKey) - epoch) / 86_400_000);
  const idx = ((day % MAP_IDS.length) + MAP_IDS.length) % MAP_IDS.length;
  return { mapId: MAP_IDS[idx]!, holeNumber: day + 1 };
}

function offlineBest(dateKey: string): number | null {
  try {
    const raw = JSON.parse(localStorage.getItem(OFFLINE_BEST_KEY) || '{}');
    return typeof raw[dateKey] === 'number' ? raw[dateKey] : null;
  } catch {
    return null;
  }
}

function setOfflineBest(dateKey: string, strokes: number): number {
  const prev = offlineBest(dateKey);
  const best = prev == null ? strokes : Math.min(prev, strokes);
  try {
    const raw = JSON.parse(localStorage.getItem(OFFLINE_BEST_KEY) || '{}');
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
  const { mapId, holeNumber } = dailyMapId(dateKey);
  return {
    postId: 'offline',
    username: null,
    daily: { dateKey, holeNumber, seed: holeNumber, mapId },
    bestToday: offlineBest(dateKey),
    streak: 0,
    mapId,
  };
}

export const apiClient = {
  async init(): Promise<InitResponse> {
    try {
      return await getJson<InitResponse>('/api/init');
    } catch {
      offlineMode = true;
      return offlineInit();
    }
  },

  async submitScore(payload: SubmitScoreRequest): Promise<SubmitScoreResponse> {
    if (!offlineMode) {
      try {
        return await postJson<SubmitScoreResponse>('/api/score', payload);
      } catch {
        offlineMode = true;
      }
    }
    const best = setOfflineBest(todayKeyUTC(), payload.strokes);
    return {
      ok: true,
      bestToday: best,
      rank: 1,
      totalPlayers: 1,
      streak: 0,
      improved: payload.strokes === best,
    };
  },

  async leaderboard(): Promise<LeaderboardResponse> {
    if (!offlineMode) {
      try {
        return await getJson<LeaderboardResponse>('/api/leaderboard');
      } catch {
        offlineMode = true;
      }
    }
    return { entries: [], totalPlayers: 0, you: null };
  },
};
