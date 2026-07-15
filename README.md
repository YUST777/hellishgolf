# Hellish Golf ⛳🔥

**One hole. Each day. Infinite rage.**

Hellish Golf is a devilishly hard daily golf challenge that lives inside the Reddit feed — built with Devvit, Phaser, and Rapier2D physics for the *Games with a Hook* hackathon.

Play it: [r/hellishgolf_dev](https://www.reddit.com/r/hellishgolf_dev) · Site: [hellishgolf.xyz](https://www.hellishgolf.xyz) ([Terms](https://www.hellishgolf.xyz/terms) · [Privacy](https://www.hellishgolf.xyz/privacy))

## What it does

* **One shared hole per day** — every player gets the same map, picked deterministically from the date, so the whole community competes on equal footing.
* **Real 2D physics** — bouncy walls, hazards, and precise shot control make every stroke count.
* **Powerups** — collect coins while playing and spend them on buffs you can arm mid-round to survive the hardest holes.
* **Leaderboards** — see how your stroke count and time stack up against everyone else that day.
* **Playable directly in the feed** — the post expands into the full game. No app install, no leaving Reddit.

The hook is retention by design: a pure, fun daily loop (no play-to-earn) that gives players a reason to open Reddit again tomorrow.

## How it's built

* **Phaser 4** for rendering, **Rapier2D** for physics.
* **Devvit** for the Reddit integration — inline feed preview card that expands into the full game webview.
* A serverless bridge connects Devvit to **Supabase** for persistent scores, streaks, and shot-by-shot replays; **Redis** is the fallback when no database is configured.
* The daily system seeds map selection from the date, so everyone gets the same challenge with zero coordination.
* Built from scratch in about 4 days with AI pair-programming (Codex and Claude). Gameplay concept and some placeholder textures were adapted from an existing browser golf game while original art is produced — see [Credits](#credits).

See [ARCHITECTURE.md](ARCHITECTURE.md) for a map of the codebase.

## Reddit experience

- Daily hole posts can be created from the moderator menu, or by a scheduled daily task.
- Scores are tied to the current Reddit account.
- Every account starts with three of each powerup.
- A first-run How to Play card covers shooting, coins, the shop, skins, powerups, checkpoints, and the finish.
- Wallets, purchases, collected coins, equipped skins, and tutorial completion persist in Devvit Redis.
- Leaderboards use Redis by default and Supabase when `DATABASE_URL` is configured; replays are stored in the `usermoves` table.

## Development

```bash
npm run dev          # local preview at http://localhost:5173 (mocked /api)
npm run lint
npm run type-check
npm run build
```

Deploying to Reddit:

```bash
npx devvit login
npx devvit playtest <subreddit>
npx devvit upload
npx devvit publish
```

## What's next

* More maps, a bigger daily rotation, and special event holes.
* Deeper streak rewards for consecutive days.
* More powerups and shop items.
* Ghost replays — watch the best run of the day.
* Weekly/monthly leaderboards and subreddit-vs-subreddit competitions.
* Fully original art and audio as the game grows.

## Credits

Hellish Golf's core concept and some interim tile/sound assets are adapted from [Kinda Hard Golf](https://kindahardgolf.com). All Reddit integration, daily-challenge systems, powerups, economy, and server code are original. Interim assets are being replaced with original art.
