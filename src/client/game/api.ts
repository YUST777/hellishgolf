import type {
  InitResponse,
  LeaderboardResponse,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from '../../shared/types';

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

export const apiClient = {
  init: () => getJson<InitResponse>('/api/init'),
  submitScore: (payload: SubmitScoreRequest) =>
    postJson<SubmitScoreResponse>('/api/score', payload),
  leaderboard: () => getJson<LeaderboardResponse>('/api/leaderboard'),
};
