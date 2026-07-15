import "dotenv/config";
import { randomUUID } from "node:crypto";
import { settings } from "@devvit/settings";
import postgres from "postgres";
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  ReplayMove,
  SubmitScoreResponse,
} from "../../shared/types";

const MAX_REPLAY_MOVES = 200;
const MAX_COORD = 200_000;
const MAX_VELOCITY = 1_000;

type CountRow = { count: number };
type BestRow = { strokes: number; time_ms: number };
type RankedRow = {
  account_id: string;
  username: string;
  strokes: number;
  time_ms: number;
  rank: number;
};

let sqlClient: postgres.Sql | null = null;
let schemaReady: Promise<void> | null = null;
let devvitSettings: Promise<DbValues> | null = null;

const DB_KEYS = [
  "DB_BRIDGE_URL",
  "DB_BRIDGE_TOKEN",
  "DATABASE_URL",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DB_SSL",
] as const;

type DbKey = (typeof DB_KEYS)[number];
type DbValues = Partial<Record<DbKey, string>>;
type BridgeConfig = { url: string; token: string };

function clean(value: unknown): string | undefined {
  const text =
    typeof value === "string" ? value : value == null ? "" : String(value);
  const trimmed = text.trim();
  return trimmed ? trimmed : undefined;
}

function processValues(): DbValues {
  const values: DbValues = {};
  for (const key of DB_KEYS) {
    const value = clean(process.env[key]);
    if (value) values[key] = value;
  }
  return values;
}

async function settingsValues(): Promise<DbValues> {
  devvitSettings ??= settings
    .getAll<Record<string, unknown>>()
    .then((all) => {
      const values: DbValues = {};
      for (const key of DB_KEYS) {
        const value = clean(all[key]);
        if (value) values[key] = value;
      }
      return values;
    })
    .catch(() => ({}));
  return devvitSettings;
}

function bridgeFrom(values: DbValues): BridgeConfig | null {
  const url = values.DB_BRIDGE_URL;
  const token = values.DB_BRIDGE_TOKEN;
  if (!url || !token) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("Database bridge must use HTTPS");
  }
  return { url: parsed.toString(), token };
}

async function bridgeConfig(): Promise<BridgeConfig | null> {
  const local = bridgeFrom(processValues());
  if (local) return local;
  return bridgeFrom(await settingsValues());
}

async function callBridge<T>(
  config: BridgeConfig,
  action: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
    error?: string;
  } | null;
  if (!response.ok || !body?.ok) {
    throw new Error(
      body?.error ?? `Database bridge failed (${response.status})`,
    );
  }
  return body.result as T;
}

function connectionString(values: DbValues): string | null {
  const direct = values.DATABASE_URL;
  if (direct) return direct;

  const host = values.DB_HOST;
  const database = values.DB_NAME;
  const user = values.DB_USER;
  const password = values.DB_PASSWORD;
  if (!host || !database || !user || !password) return null;

  const port = values.DB_PORT ?? "5432";
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  const params = values.DB_SSL === "disable" ? "" : "?sslmode=require";
  return `postgresql://${auth}@${host}:${port}/${database}${params}`;
}

function sslEnabled(url: string, values: DbValues): boolean {
  const raw = values.DB_SSL?.toLowerCase();
  if (raw && ["0", "false", "off", "no", "disable", "disabled"].includes(raw)) {
    return false;
  }
  return !url.includes("sslmode=disable");
}

async function connectionConfig(): Promise<{
  url: string;
  ssl: boolean;
} | null> {
  const local = processValues();
  const localUrl = connectionString(local);
  if (localUrl) return { url: localUrl, ssl: sslEnabled(localUrl, local) };

  const fromSettings = await settingsValues();
  const settingsUrl = connectionString(fromSettings);
  if (!settingsUrl) return null;
  return { url: settingsUrl, ssl: sslEnabled(settingsUrl, fromSettings) };
}

async function sql(): Promise<postgres.Sql | null> {
  if (sqlClient) return sqlClient;

  const config = await connectionConfig();
  if (!config) return null;

  if (!sqlClient) {
    const options: postgres.Options<Record<string, never>> = {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => undefined,
    };
    if (config.ssl) options.ssl = "require";
    sqlClient = postgres(config.url, options);
  }
  return sqlClient;
}

export async function isSupabaseConfigured(): Promise<boolean> {
  return (await bridgeConfig()) !== null || (await connectionConfig()) !== null;
}

async function createSchema(db: postgres.Sql): Promise<void> {
  await db`
    CREATE TABLE IF NOT EXISTS players (
      account_id text PRIMARY KEY,
      username text NOT NULL,
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS leaderboard (
      date_key text NOT NULL,
      post_id text NOT NULL,
      account_id text NOT NULL,
      username text NOT NULL,
      map_id integer NOT NULL,
      strokes integer NOT NULL CHECK (strokes > 0),
      time_ms integer NOT NULL CHECK (time_ms >= 0),
      streak integer NOT NULL DEFAULT 0,
      replay_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (date_key, post_id, account_id)
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS leaderboard_order_idx
    ON leaderboard (date_key, post_id, strokes, time_ms, updated_at, username)
  `;

  await db`
    CREATE TABLE IF NOT EXISTS usermoves (
      id text PRIMARY KEY,
      date_key text NOT NULL,
      post_id text NOT NULL,
      account_id text NOT NULL,
      username text NOT NULL,
      map_id integer NOT NULL,
      strokes integer NOT NULL CHECK (strokes > 0),
      time_ms integer NOT NULL CHECK (time_ms >= 0),
      moves jsonb NOT NULL CHECK (jsonb_typeof(moves) = 'array'),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS usermoves_player_idx
    ON usermoves (date_key, post_id, account_id, created_at DESC)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS usermoves_post_idx
    ON usermoves (post_id, created_at DESC)
  `;

  await db`
    ALTER TABLE leaderboard
    ADD COLUMN IF NOT EXISTS replay_id text
  `;

  await db`ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS account_id text`;
  await db`ALTER TABLE usermoves ADD COLUMN IF NOT EXISTS account_id text`;
  await db`
    UPDATE leaderboard
    SET account_id = 'legacy:' || lower(username)
    WHERE account_id IS NULL
  `;
  await db`
    UPDATE usermoves
    SET account_id = 'legacy:' || lower(username)
    WHERE account_id IS NULL
  `;
  await db`ALTER TABLE leaderboard ALTER COLUMN account_id SET NOT NULL`;
  await db`ALTER TABLE usermoves ALTER COLUMN account_id SET NOT NULL`;
  await db`
    DO $$
    DECLARE current_key text;
    BEGIN
      SELECT string_agg(a.attname, ',' ORDER BY u.ordinality)
      INTO current_key
      FROM pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      WHERE c.conrelid = 'leaderboard'::regclass AND c.contype = 'p';

      IF current_key IS DISTINCT FROM 'date_key,post_id,account_id' THEN
        ALTER TABLE leaderboard DROP CONSTRAINT IF EXISTS leaderboard_pkey;
        ALTER TABLE leaderboard
          ADD CONSTRAINT leaderboard_pkey PRIMARY KEY (date_key, post_id, account_id);
      END IF;
    END $$
  `;
  await db`DROP INDEX IF EXISTS usermoves_player_idx`;
  await db`
    CREATE INDEX IF NOT EXISTS usermoves_player_idx
    ON usermoves (date_key, post_id, account_id, created_at DESC)
  `;
  await db`ALTER TABLE players ENABLE ROW LEVEL SECURITY`;
  await db`ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY`;
  await db`ALTER TABLE usermoves ENABLE ROW LEVEL SECURITY`;
  await db`
    REVOKE ALL ON TABLE players, leaderboard, usermoves
    FROM PUBLIC, anon, authenticated
  `;
}

export async function ensureSupabaseSchema(): Promise<boolean> {
  const db = await sql();
  if (!db) return false;

  schemaReady ??= createSchema(db).catch((error) => {
    schemaReady = null;
    throw error;
  });
  await schemaReady;
  return true;
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function rounded(value: number, places = 3): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function sanitizeBaseMove(
  move: Record<string, unknown>,
): Pick<ReplayMove, "t" | "x" | "y"> | null {
  const t = clampNumber(move.t, 0, 86_400_000);
  const x = clampNumber(move.x, -MAX_COORD, MAX_COORD);
  const y = clampNumber(move.y, -MAX_COORD, MAX_COORD);
  if (t === null || x === null || y === null) return null;
  return {
    t: Math.round(t),
    x: rounded(x),
    y: rounded(y),
  };
}

export function sanitizeReplayMoves(value: unknown): ReplayMove[] {
  if (!Array.isArray(value)) return [];

  const moves: ReplayMove[] = [];
  for (const raw of value.slice(0, MAX_REPLAY_MOVES)) {
    if (!raw || typeof raw !== "object") continue;
    const move = raw as Record<string, unknown>;
    const base = sanitizeBaseMove(move);
    if (!base) continue;

    if (move.type === "powerup") {
      const powerup = move.powerup;
      if (
        powerup !== "trajectory" &&
        powerup !== "sticky" &&
        powerup !== "checkpoint"
      ) {
        continue;
      }
      const sanitized: ReplayMove = {
        type: "powerup",
        powerup,
        ...base,
      };
      const targetX = clampNumber(move.targetX, -MAX_COORD, MAX_COORD);
      const targetY = clampNumber(move.targetY, -MAX_COORD, MAX_COORD);
      if (targetX !== null) sanitized.targetX = rounded(targetX);
      if (targetY !== null) sanitized.targetY = rounded(targetY);
      moves.push(sanitized);
      continue;
    }

    const shot = clampNumber(move.shot, 1, 999);
    const dragX = clampNumber(move.dragX, -MAX_COORD, MAX_COORD);
    const dragY = clampNumber(move.dragY, -MAX_COORD, MAX_COORD);
    const power = clampNumber(move.power, 0, 1);
    const velocityX = clampNumber(move.velocityX, -MAX_VELOCITY, MAX_VELOCITY);
    const velocityY = clampNumber(move.velocityY, -MAX_VELOCITY, MAX_VELOCITY);

    if (
      shot === null ||
      dragX === null ||
      dragY === null ||
      power === null ||
      velocityX === null ||
      velocityY === null
    ) {
      continue;
    }

    moves.push({
      type: "shot",
      shot: Math.floor(shot),
      ...base,
      dragX: rounded(dragX),
      dragY: rounded(dragY),
      power: rounded(power, 4),
      velocityX: rounded(velocityX),
      velocityY: rounded(velocityY),
    });
  }
  return moves;
}

async function readySql(): Promise<postgres.Sql> {
  const db = await sql();
  if (!db) throw new Error("Supabase database env is not configured");
  await ensureSupabaseSchema();
  return db;
}

export async function getSupabaseBest(
  dateKey: string,
  postId: string,
  accountId: string,
): Promise<number | null> {
  const bridge = await bridgeConfig();
  if (bridge) {
    return callBridge<number | null>(bridge, "getBest", {
      dateKey,
      postId,
      accountId,
    });
  }
  const db = await readySql();
  const rows = await db<BestRow[]>`
    SELECT strokes, time_ms
    FROM leaderboard
    WHERE date_key = ${dateKey}
      AND post_id = ${postId}
      AND account_id = ${accountId}
    LIMIT 1
  `;
  return rows[0]?.strokes ?? null;
}

export async function submitSupabaseScore(params: {
  dateKey: string;
  postId: string;
  accountId: string;
  username: string;
  mapId: number;
  strokes: number;
  timeMs: number;
  streak: number;
  moves: ReplayMove[];
}): Promise<SubmitScoreResponse> {
  const bridge = await bridgeConfig();
  if (bridge) {
    return callBridge<SubmitScoreResponse>(bridge, "submitScore", { params });
  }
  const db = await readySql();

  return db.begin(async (tx) => {
    const replayId = randomUUID();
    const replayJson = params.moves as unknown as Parameters<typeof tx.json>[0];
    await tx`
      INSERT INTO usermoves (
        id,
        date_key,
        post_id,
        account_id,
        username,
        map_id,
        strokes,
        time_ms,
        moves
      )
      VALUES (
        ${replayId},
        ${params.dateKey},
        ${params.postId},
        ${params.accountId},
        ${params.username},
        ${params.mapId},
        ${params.strokes},
        ${params.timeMs},
        ${tx.json(replayJson)}
      )
    `;

    const changed = await tx<BestRow[]>`
      INSERT INTO leaderboard (
        date_key,
        post_id,
        account_id,
        username,
        map_id,
        strokes,
        time_ms,
        streak,
        replay_id
      )
      VALUES (
        ${params.dateKey},
        ${params.postId},
        ${params.accountId},
        ${params.username},
        ${params.mapId},
        ${params.strokes},
        ${params.timeMs},
        ${params.streak},
        ${replayId}
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
        OR (
          leaderboard.strokes = EXCLUDED.strokes
          AND leaderboard.time_ms > EXCLUDED.time_ms
        )
      RETURNING strokes, time_ms
    `;

    const bestRows = await tx<BestRow[]>`
      SELECT strokes, time_ms
      FROM leaderboard
      WHERE date_key = ${params.dateKey}
        AND post_id = ${params.postId}
        AND account_id = ${params.accountId}
      LIMIT 1
    `;

    const best = bestRows[0] ?? {
      strokes: params.strokes,
      time_ms: params.timeMs,
    };

    const totalRows = await tx<CountRow[]>`
      SELECT count(*)::int AS count
      FROM leaderboard
      WHERE date_key = ${params.dateKey}
        AND post_id = ${params.postId}
    `;

    const youRows = await tx<RankedRow[]>`
      WITH ranked AS (
        SELECT
          account_id,
          username,
          strokes,
          time_ms,
          CAST(row_number() OVER (
            ORDER BY strokes ASC, time_ms ASC, updated_at ASC, username ASC
          ) AS integer) AS rank
        FROM leaderboard
        WHERE date_key = ${params.dateKey}
          AND post_id = ${params.postId}
      )
      SELECT account_id, username, strokes, time_ms, rank
      FROM ranked
      WHERE account_id = ${params.accountId}
      LIMIT 1
    `;

    return {
      ok: true,
      bestToday: best.strokes,
      rank: youRows[0]?.rank ?? 1,
      totalPlayers: totalRows[0]?.count ?? 1,
      streak: params.streak,
      improved: changed.length > 0,
    };
  });
}

export async function getSupabaseLeaderboard(params: {
  dateKey: string;
  postId: string;
  accountId: string | null;
  limit?: number;
}): Promise<LeaderboardResponse> {
  const { dateKey, postId, accountId, limit = 10 } = params;
  const bridge = await bridgeConfig();
  if (bridge) {
    return callBridge<LeaderboardResponse>(bridge, "getLeaderboard", {
      dateKey,
      postId,
      accountId,
      limit,
    });
  }
  const db = await readySql();

  const totalRows = await db<CountRow[]>`
    SELECT count(*)::int AS count
    FROM leaderboard
    WHERE date_key = ${dateKey}
      AND post_id = ${postId}
  `;

  const topRows = await db<RankedRow[]>`
    WITH ranked AS (
      SELECT
        account_id,
        username,
        strokes,
        time_ms,
        CAST(row_number() OVER (
          ORDER BY strokes ASC, time_ms ASC, updated_at ASC, username ASC
        ) AS integer) AS rank
      FROM leaderboard
      WHERE date_key = ${dateKey}
        AND post_id = ${postId}
    )
    SELECT account_id, username, strokes, time_ms, rank
    FROM ranked
    ORDER BY rank ASC
    LIMIT ${limit}
  `;

  const entries: LeaderboardEntry[] = topRows.map((row) => ({
    username: row.username,
    strokes: row.strokes,
    rank: row.rank,
  }));

  let you: LeaderboardEntry | null = null;
  if (accountId) {
    const youRows = await db<RankedRow[]>`
      WITH ranked AS (
        SELECT
          account_id,
          username,
          strokes,
          time_ms,
          CAST(row_number() OVER (
            ORDER BY strokes ASC, time_ms ASC, updated_at ASC, username ASC
          ) AS integer) AS rank
        FROM leaderboard
        WHERE date_key = ${dateKey}
          AND post_id = ${postId}
      )
      SELECT account_id, username, strokes, time_ms, rank
      FROM ranked
      WHERE account_id = ${accountId}
      LIMIT 1
    `;
    const row = youRows[0];
    if (row) {
      you = {
        username: row.username,
        strokes: row.strokes,
        rank: row.rank,
      };
    }
  }

  return { entries, totalPlayers: totalRows[0]?.count ?? 0, you };
}

export async function registerSupabasePlayer(
  accountId: string,
  username: string,
): Promise<boolean> {
  if (!(await isSupabaseConfigured())) return false;
  const bridge = await bridgeConfig();
  if (bridge) {
    return callBridge<boolean>(bridge, "registerPlayer", {
      accountId,
      username,
    });
  }
  const db = await readySql();
  await db`
    INSERT INTO players (account_id, username)
    VALUES (${accountId}, ${username})
    ON CONFLICT (account_id)
    DO UPDATE SET username = EXCLUDED.username, last_seen_at = now()
  `;
  return true;
}
