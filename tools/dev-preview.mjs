// Local preview harness for the Hellish Golf client.
//
// Devvit apps normally run inside Reddit via `devvit playtest`, which needs a
// Reddit login and injects the real /api server. This script lets you play the
// built client in a plain browser by serving dist/client and MOCKING the three
// API endpoints the client calls (/api/init, /api/score, /api/leaderboard).
//
// It is a dev-only convenience and is NOT part of the shipped app.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = normalize(join(__dirname, "..", "dist", "client"));
const PORT = Number(process.env.PORT ?? 5173);

// --- live reload -------------------------------------------------------------
// Connected browser tabs listening on the SSE stream. When dist/client changes
// (vite build --watch rewrites it) we ping them and they reload themselves.
const reloadClients = new Set();

// Injected into every served HTML page: opens an SSE connection and reloads on
// the 'reload' event. Debounced on the server side so one rebuild = one reload.
const LIVE_RELOAD_SNIPPET = `
<script>
(function () {
  try {
    var es = new EventSource('/__reload');
    es.addEventListener('reload', function () { location.reload(); });
    es.onerror = function () { /* server restarting; browser retries automatically */ };
  } catch (e) {}
})();
</script>`;

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const res of reloadClients) {
      try {
        res.write("event: reload\ndata: 1\n\n");
      } catch {
        // Browser tab disconnected between scheduling and writing.
      }
    }
  }, 150);
}

// --- import the real level generator so the mock hole matches production -----
// (dist is JS; we re-derive a seed the same way the server would.)
function seedFromDateKey(dateKey) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function currentDateKey() {
  const shifted = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// The set of real mirrored maps (mirrors src/shared/mapManifest.ts).
const MAP_IDS = [
  1, 2, 450, 451, 452, 453, 454, 455, 456, 457, 458, 459, 460, 461, 462, 463,
  464, 465, 466, 467, 468, 469, 470,
];

const dateKey = currentDateKey();
const seed = seedFromDateKey(dateKey);

// Pick the daily map deterministically, same as the real server.
const mapId = MAP_IDS[(seed >>> 0) % MAP_IDS.length];
// Allow overriding the hole for testing: /?map=465
function resolveMapId(url) {
  const q = Number(url.searchParams.get("map"));
  return MAP_IDS.includes(q) ? q : mapId;
}

// In-memory leaderboard for this preview session.
const board = [
  { username: "sandtrap_sally", strokes: 6 },
  { username: "birdie_ben", strokes: 8 },
  { username: "bogey_bot", strokes: 11 },
];
let you = null;
let streak = 0;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function rankBoard() {
  const all = [...board];
  if (you) all.push(you);
  all.sort((a, b) => a.strokes - b.strokes);
  return all;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    return res.end("Bad request");
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }

  // --- mocked API ------------------------------------------------------------
  if (pathname === "/api/init") {
    const id = resolveMapId(url);
    return sendJson(res, 200, {
      postId: "preview_post",
      accountId: "t2_preview",
      username: "you_the_dev",
      daily: { dateKey, holeNumber: 42, seed, mapId: id },
      bestToday: you ? you.strokes : null,
      streak,
      mapId: id,
      player: null,
    });
  }

  if (pathname === "/api/score" && req.method === "POST") {
    const body = await readBody(req);
    const strokes = Math.max(1, Math.floor(Number(body.strokes) || 1));
    const improved = !you || strokes < you.strokes;
    if (improved) you = { username: "you_the_dev", strokes };
    streak = Math.max(streak, 1);
    const ranked = rankBoard();
    const rank = ranked.findIndex((e) => e.username === "you_the_dev") + 1;
    return sendJson(res, 200, {
      ok: true,
      bestToday: you.strokes,
      rank,
      totalPlayers: ranked.length,
      streak,
      improved,
    });
  }

  if (pathname === "/api/leaderboard") {
    const ranked = rankBoard().map((e, i) => ({ ...e, rank: i + 1 }));
    return sendJson(res, 200, {
      entries: ranked.slice(0, 10),
      totalPlayers: ranked.length,
      you: you
        ? (ranked.find((e) => e.username === "you_the_dev") ?? null)
        : null,
    });
  }

  // --- live reload (Server-Sent Events) --------------------------------------
  if (pathname === "/__reload") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 500\n\n");
    reloadClients.add(res);
    req.on("close", () => reloadClients.delete(res));
    return;
  }

  // --- static files ----------------------------------------------------------
  if (pathname === "/") pathname = "/game.html";

  const filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] ?? "application/octet-stream";
    // Inject the live-reload client into any served HTML.
    if (type.startsWith("text/html")) {
      const html = data
        .toString("utf8")
        .replace("</body>", `${LIVE_RELOAD_SNIPPET}</body>`);
      res.writeHead(200, { "content-type": type });
      return res.end(html);
    }
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
});

// A single bad request must never take the whole preview server down.
server.on("clientError", (_err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});
process.on("uncaughtException", (err) => {
  console.error("preview: uncaught", err?.message ?? err);
});

// Watch the built client and tell connected tabs to reload on any change.
// `vite build --watch` rewrites dist/client on every source edit.
try {
  watch(ROOT, { recursive: true }, () => scheduleReload());
  console.log("Live reload: watching dist/client for changes");
} catch (err) {
  console.warn(
    "Live reload watch failed (edits still served, just no auto-refresh):",
    err?.message ?? err,
  );
}

server.listen(PORT, () => {
  console.log(`Hellish Golf preview running at http://localhost:${PORT}/`);
  console.log("(mocked /api — real data only works via `devvit playtest`)");
});
