# Architecture

Hellish Golf is a Devvit (Reddit) web-view game: a Phaser 4 client with
Rapier 2D physics, a Devvit server backed by Redis, and an optional
Supabase bridge for cross-post leaderboards and replays.

```
devvit.json          Devvit app config: entrypoints, permissions, scheduler
vite.config.ts       Builds src/client -> dist/client and src/server -> dist/server
vercel.json          Static hosting + /api/game-db bridge deployment
api/game-db.ts       Vercel serverless function: HTTPS bridge to Supabase Postgres
supabase/            SQL schema for players / scores / usermoves tables
public/game/         Static runtime assets (audio, cursors, textures, tilemaps)
tools/               Dev-only scripts (local preview server)
```

## Client (`src/client`)

| File | Role |
| --- | --- |
| `game.html` | DOM shell: HUD, menus, shop, leaderboard, tutorial dialogs |
| `styles.css` | All UI styling, including boot/inline presentation modes |
| `game/main.ts` | Client bootstrap: init fetch, Rapier load, game start |
| `game/state.ts` | Shared mutable session state (`ctx`) + boot-preview bridge |
| `game/wiring.ts` | DOM control wiring, scene-event bridge, quick guide |
| `game/session.ts` | Map loading, Phaser boot, finish handling, hole restart |
| `game/hud.ts` | Strokes/best/streak HUD and the powerup quick bar |
| `game/shop.ts` | Shop overlay: powerup purchases, skin buy/equip |
| `game/leaderboard.ts` | Leaderboard overlay fetch + render |
| `game/result.ts` | Result modal, confetti, next-hole countdown |
| `game/settings.ts` | Zoom / sound / Infuriating Mode preferences |
| `game/dom.ts` | `el`/`show`/`hide`/`toast` DOM helpers |
| `game/GameScene.ts` | The Phaser scene: ball physics, input, powerups, sensors |
| `game/colliders.ts` | Static Rapier geometry + sensor rects from the tilemap |
| `game/trajectory.ts` | Trajectory powerup prediction on a snapshot world |
| `game/coinSpots.ts` | Deterministic daily coin placement |
| `game/sceneTextures.ts` | Procedural textures (ball, coin, flag) + backdrop |
| `game/sceneTypes.ts` | Shared scene types (zones, pickups, launch vectors) |
| `game/physics.ts` | Rapier 2D WASM bootstrap |
| `game/api.ts` | `/api/*` client with a static-host (offline) fallback |
| `game/inlineMode.ts` | Inline feed presentation: game-only view, tap to expand |
| `game/powerups.ts` | Wallet/inventory/skins state, localStorage persistence |
| `game/sound.ts` | SFX playback |
| `game/config.ts` | Client constants |

`public/game/boot-preview.js` is loaded before the JS bundle and paints a
live, button-free preview of today's hole while the game boots
(`body.booting` hides every other layer). The same hiding technique powers
inline feed mode (`body.inline-view`), where a full-screen overlay expands
the post on first tap via `requestExpandedMode`.

## Server (`src/server`)

| File | Role |
| --- | --- |
| `index.ts` | Devvit server entry; mounts routes |
| `routes/api.ts` | Game API: init, score submit, coins, powerups, leaderboard |
| `routes/menu.ts` | Moderator "create hole post" menu action |
| `routes/scheduler.ts` | Daily 05:00 UTC hole rollover task |
| `routes/triggers.ts` | App-install trigger (creates the first post) |
| `core/daily.ts` | Date key / day number / per-day map selection |
| `core/scoring.ts` | Redis leaderboards, streaks, best-score logic |
| `core/player.ts` | Per-account wallet, inventory, skins, tutorial state |
| `core/post.ts` | Post creation and map snapshotting |
| `core/supabase.ts` | Optional Postgres/HTTPS-bridge persistence layer |

## Shared (`src/shared`)

Types and pure logic used by both sides: tilemap parsing (`tiled.ts`,
`tiles.ts`), the daily map pool (`mapManifest.ts`), seeded level selection
(`level.ts`), and the economy rules (`economy.ts`).

## Data flow

1. Post opens → client calls `/api/init` → server resolves today's hole
   (or the post's pinned map), player state, and best score.
2. Scores/coins/powerup use POST back to the Devvit server, which stores
   them in Redis and, when configured, mirrors them to Supabase — directly
   over Postgres or through the Vercel `api/game-db.ts` HTTPS bridge
   (Devvit runtimes cannot open raw sockets).
3. On plain static hosting there is no Devvit server; `game/api.ts`
   detects this and falls back to a fully client-side daily mode with a
   localStorage best score.
