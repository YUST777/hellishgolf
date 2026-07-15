# Hellish Golf

Hellish Golf is a daily vertical golf challenge for Reddit, built with Devvit, Phaser, Rapier physics, Redis, and optional Supabase storage.

Players launch a golf ball through a difficult climbing course, collect coins, buy powerups, reach checkpoints, and compete for the lowest-stroke daily leaderboard. The Reddit feed shows an inline preview card, and opening the post launches the full game webview.

## Reddit Experience

- Daily hole posts can be created from the moderator menu.
- A scheduled daily task can create a fresh hole each day.
- Scores are tied to the current Reddit username.
- Every Reddit account starts with three of each powerup.
- A first-run How to Play card explains shooting, coins, the shop, skins, powerups, checkpoints, and the finish before play begins.
- Account wallets, purchases, collected coins, equipped skins, and tutorial completion persist in Devvit Redis.
- Leaderboards use Redis by default and Supabase when configured.
- Replays are stored in the usermoves table when Supabase is available.

## Required Devvit Settings

Set DATABASE_URL if you want Supabase-backed leaderboard and replay storage. Without it, the game falls back to Redis leaderboards.

## Local Commands

- npm run lint
- npm run format:check
- npm run type-check
- npm run build
- npm run dev

## Devvit Commands

- npx devvit login
- npx devvit playtest <subreddit>
- npx devvit upload
- npx devvit publish
