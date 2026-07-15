import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import postgres from "postgres";
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  ReplayMove,
  SubmitScoreResponse,
} from "../src/shared/types";

type RankedRow = {
  account_id: string;
  username: string;
  strokes: number;
  time_ms: number;
  rank: number;
};

type BestRow = { strokes: number; time_ms: number };
type CountRow = { count: number };
type VercelRequest = IncomingMessage & { body?: unknown };

const MAX_BODY_BYTES = 1_000_000;

let client: postgres.Sql | null = null;

function database(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  client ??= postgres(url, {
    ssl: "require",
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
  });
  return client;
}

function authorized(request: VercelRequest): boolean {
  const expected = process.env.DB_BRIDGE_TOKEN;
  const rawHeader = request.headers.authorization;
  const header = Array.isArray(rawHeader)
    ? (rawHeader[0] ?? "")
    : (rawHeader ?? "");
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

function parseBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    return body as Record<string, unknown>;
  }
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    return JSON.parse(body.toString()) as Record<string, unknown>;
  }
  throw new Error("Request body must be a JSON object");
}

async function readBody(
  request: VercelRequest,
): Promise<Record<string, unknown>> {
  if (request.body !== undefined) return parseBody(request.body);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error("Request body is required");
  return parseBody(Buffer.concat(chunks));
}

async function registerPlayer(body: Record<string, unknown>): Promise<boolean> {
  const accountId = String(body.accountId ?? "");
  const username = String(body.username ?? "");
  if (!/^t2_[a-z0-9]+$/i.test(accountId) || !username) {
    throw new Error("Invalid Reddit player identity");
  }
  const sql = database();
  await sql`
    INSERT INTO players (account_id, username)
    VALUES (${accountId}, ${username})
    ON CONFLICT (account_id)
    DO UPDATE SET username = EXCLUDED.username, last_seen_at = now()
  `;
  return true;
}

async function getBest(body: Record<string, unknown>): Promise<number | null> {
  const sql = database();
  const rows = await sql<BestRow[]>`
    SELECT strokes, time_ms
    FROM leaderboard
    WHERE date_key = ${String(body.dateKey ?? "")}
      AND post_id = ${String(body.postId ?? "")}
      AND account_id = ${String(body.accountId ?? "")}
    LIMIT 1
  `;
  return rows[0]?.strokes ?? null;
}

async function submitScore(
  body: Record<string, unknown>,
): Promise<SubmitScoreResponse> {
  const params = (body.params ?? {}) as Record<string, unknown>;
  const dateKey = String(params.dateKey ?? "");
  const postId = String(params.postId ?? "");
  const accountId = String(params.accountId ?? "");
  const username = String(params.username ?? "");
  const mapId = Number(params.mapId);
  const strokes = Number(params.strokes);
  const timeMs = Number(params.timeMs);
  const streak = Number(params.streak);
  const moves = Array.isArray(params.moves)
    ? (params.moves as ReplayMove[])
    : [];
  if (!dateKey || !postId || !/^t2_[a-z0-9]+$/i.test(accountId) || !username) {
    throw new Error("Invalid score identity");
  }
  if (![mapId, strokes, timeMs, streak].every(Number.isFinite)) {
    throw new Error("Invalid score values");
  }

  const sql = database();
  return sql.begin(async (tx) => {
    const replayId = randomUUID();
    await tx`
      INSERT INTO usermoves (
        id, date_key, post_id, account_id, username,
        map_id, strokes, time_ms, moves
      )
      VALUES (
        ${replayId}, ${dateKey}, ${postId}, ${accountId}, ${username},
        ${Math.floor(mapId)}, ${Math.floor(strokes)}, ${Math.floor(timeMs)},
        ${tx.json(moves as unknown as Parameters<typeof tx.json>[0])}
      )
    `;

    const changed = await tx<BestRow[]>`
      INSERT INTO leaderboard (
        date_key, post_id, account_id, username, map_id,
        strokes, time_ms, streak, replay_id
      )
      VALUES (
        ${dateKey}, ${postId}, ${accountId}, ${username}, ${Math.floor(mapId)},
        ${Math.floor(strokes)}, ${Math.floor(timeMs)}, ${Math.floor(streak)}, ${replayId}
      )
      ON CONFLICT (date_key, post_id, account_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        map_id = EXCLUDED.map_id,
        strokes = EXCLUDED.strokes,
        time_ms = EXCLUDED.time_ms,
        streak = EXCLUDED.streak,
        replay_id = EXCLUDED.replay_id,
        updated_at = now()
      WHERE leaderboard.strokes > EXCLUDED.strokes
        OR (leaderboard.strokes = EXCLUDED.strokes AND leaderboard.time_ms > EXCLUDED.time_ms)
      RETURNING strokes, time_ms
    `;

    const bestRows = await tx<BestRow[]>`
      SELECT strokes, time_ms FROM leaderboard
      WHERE date_key = ${dateKey} AND post_id = ${postId} AND account_id = ${accountId}
      LIMIT 1
    `;
    const totalRows = await tx<CountRow[]>`
      SELECT count(*)::int AS count FROM leaderboard
      WHERE date_key = ${dateKey} AND post_id = ${postId}
    `;
    const youRows = await tx<RankedRow[]>`
      WITH ranked AS (
        SELECT account_id, username, strokes, time_ms,
          CAST(row_number() OVER (
            ORDER BY strokes ASC, time_ms ASC, updated_at ASC, username ASC
          ) AS integer) AS rank
        FROM leaderboard
        WHERE date_key = ${dateKey} AND post_id = ${postId}
      )
      SELECT account_id, username, strokes, time_ms, rank
      FROM ranked WHERE account_id = ${accountId} LIMIT 1
    `;
    const best = bestRows[0] ?? {
      strokes: Math.floor(strokes),
      time_ms: Math.floor(timeMs),
    };
    return {
      ok: true,
      bestToday: best.strokes,
      rank: youRows[0]?.rank ?? 1,
      totalPlayers: totalRows[0]?.count ?? 1,
      streak: Math.floor(streak),
      improved: changed.length > 0,
    };
  });
}

async function getLeaderboard(
  body: Record<string, unknown>,
): Promise<LeaderboardResponse> {
  const dateKey = String(body.dateKey ?? "");
  const postId = String(body.postId ?? "");
  const accountId = body.accountId == null ? null : String(body.accountId);
  const limit = Math.max(
    1,
    Math.min(100, Math.floor(Number(body.limit) || 10)),
  );
  const sql = database();
  const totalRows = await sql<CountRow[]>`
    SELECT count(*)::int AS count FROM leaderboard
    WHERE date_key = ${dateKey} AND post_id = ${postId}
  `;
  const topRows = await sql<RankedRow[]>`
    WITH ranked AS (
      SELECT account_id, username, strokes, time_ms,
        CAST(row_number() OVER (
          ORDER BY strokes ASC, time_ms ASC, updated_at ASC, username ASC
        ) AS integer) AS rank
      FROM leaderboard
      WHERE date_key = ${dateKey} AND post_id = ${postId}
    )
    SELECT account_id, username, strokes, time_ms, rank
    FROM ranked ORDER BY rank ASC LIMIT ${limit}
  `;
  const entries: LeaderboardEntry[] = topRows.map((row) => ({
    username: row.username,
    strokes: row.strokes,
    rank: row.rank,
  }));
  let you: LeaderboardEntry | null = null;
  if (accountId) {
    const youRows = await sql<RankedRow[]>`
      WITH ranked AS (
        SELECT account_id, username, strokes, time_ms,
          CAST(row_number() OVER (
            ORDER BY strokes ASC, time_ms ASC, updated_at ASC, username ASC
          ) AS integer) AS rank
        FROM leaderboard
        WHERE date_key = ${dateKey} AND post_id = ${postId}
      )
      SELECT account_id, username, strokes, time_ms, rank
      FROM ranked WHERE account_id = ${accountId} LIMIT 1
    `;
    const row = youRows[0];
    if (row)
      you = { username: row.username, strokes: row.strokes, rank: row.rank };
  }
  return { entries, totalPlayers: totalRows[0]?.count ?? 0, you };
}

export default async function handler(
  request: VercelRequest,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    json(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  if (!authorized(request)) {
    json(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }
  try {
    const body = await readBody(request);
    let result: unknown;
    switch (body.action) {
      case "registerPlayer":
        result = await registerPlayer(body);
        break;
      case "getBest":
        result = await getBest(body);
        break;
      case "submitScore":
        result = await submitScore(body);
        break;
      case "getLeaderboard":
        result = await getLeaderboard(body);
        break;
      default:
        json(response, 400, { ok: false, error: "Unknown action" });
        return;
    }
    json(response, 200, { ok: true, result });
  } catch (error) {
    console.error("database bridge error", error);
    json(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Database bridge failed",
    });
  }
}
