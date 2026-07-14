import Phaser from 'phaser';
import { GameScene } from './GameScene';
import { GRAVITY_Y, TILE, TILESET_URL } from './config';
import { apiClient } from './api';
import { mapUrl } from '../../shared/mapManifest';
import { parseTiledMap, type RuntimeMap } from '../../shared/tiled';
import { TILESET } from '../../shared/tiles';
import type { InitResponse, LeaderboardResponse } from '../../shared/types';

/**
 * Client bootstrap. Fetches the post's hole (a real mirrored Tiled map) from
 * the server, loads the map JSON + tileset atlas, boots Phaser with GameScene,
 * and manages the HUD/overlays around the canvas.
 */

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

let game: Phaser.Game | null = null;
let init: InitResponse | null = null;
let runtimeMap: RuntimeMap | null = null;

function setHud(strokes: number, best: number | null, streak: number) {
  el('hud-strokes').textContent = String(strokes);
  el('hud-best').textContent = best == null ? '\u2014' : String(best);
  el('hud-streak').textContent = streak > 0 ? `\uD83D\uDD25 ${streak}` : '\u2014';
}

/** Load the raw Tiled JSON for a map id and parse it into the runtime model. */
async function loadMap(mapId: number): Promise<RuntimeMap> {
  const res = await fetch(mapUrl(mapId));
  if (!res.ok) throw new Error(`Failed to load map ${mapId}: ${res.status}`);
  const json = await res.json();
  return parseTiledMap(json);
}

function sceneData() {
  return {
    map: runtimeMap!,
    onStroke: (n: number) => setHud(n, init?.bestToday ?? null, init?.streak ?? 0),
    onCheckpoint: () => flashToast('Checkpoint! \uD83D\uDEA9'),
    onFinish: (strokes: number, timeMs: number) => onFinish(strokes, timeMs),
  };
}

function startGame(data: InitResponse, map: RuntimeMap) {
  init = data;
  runtimeMap = map;

  el('loading').classList.add('hidden');

  setHud(0, data.bestToday, data.streak);
  el('hole-number').textContent = `#${data.daily.holeNumber}`;
  el('hole-date').textContent = data.daily.dateKey;

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-root',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#1f79cd',
    pixelArt: true,
    physics: {
      default: 'matter',
      matter: {
        gravity: { x: 0, y: GRAVITY_Y },
        debug: false,
        // Fixed 60Hz timestep + more solver iterations => stable, frame-rate
        // independent simulation and far less tunneling through thin walls.
        runner: { fps: 60, maxUpdates: 4, maxFrameTime: 1000 / 30 },
        positionIterations: 12,
        velocityIterations: 10,
        constraintIterations: 4,
      },
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: new (class extends Phaser.Scene {
      constructor() {
        super('boot');
      }
      preload() {
        this.load.spritesheet('tileset', TILESET_URL, {
          frameWidth: TILESET.tileWidth,
          frameHeight: TILESET.tileHeight,
        });
      }
      create() {
        this.scene.add('game', GameScene, true, sceneData());
      }
    })(),
  });

  void TILE;
}

async function onFinish(strokes: number, timeMs: number) {
  showResult(strokes, timeMs, null, null);
  try {
    const res = await apiClient.submitScore({ strokes, timeMs });
    if (init) {
      init.bestToday = res.bestToday;
      init.streak = res.streak;
    }
    setHud(strokes, res.bestToday, res.streak);
    showResult(strokes, timeMs, res.rank, res.totalPlayers);
    void loadLeaderboard();
  } catch (err) {
    console.error('score submit failed', err);
  }
}

function showResult(
  strokes: number,
  timeMs: number,
  rank: number | null,
  total: number | null
) {
  const overlay = el('result-overlay');
  overlay.classList.remove('hidden');
  el('result-strokes').textContent = String(strokes);
  el('result-time').textContent = `${(timeMs / 1000).toFixed(1)}s`;
  el('result-rank').textContent =
    rank && total ? `Rank ${rank} of ${total}` : 'Submitting\u2026';
}

function flashToast(msg: string) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  window.setTimeout(() => t.classList.remove('show'), 1400);
}

async function loadLeaderboard() {
  try {
    const lb: LeaderboardResponse = await apiClient.leaderboard();
    const list = el('leaderboard-list');
    list.innerHTML = '';
    if (lb.entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'lb-empty';
      li.textContent = 'Be the first to finish today!';
      list.appendChild(li);
    }
    for (const e of lb.entries) {
      const li = document.createElement('li');
      const you = lb.you && lb.you.username === e.username;
      if (you) li.className = 'you';
      li.innerHTML = `<span class="lb-rank">${e.rank}</span><span class="lb-name">u/${e.username}</span><span class="lb-score">${e.strokes}</span>`;
      list.appendChild(li);
    }
    el('lb-total').textContent = `${lb.totalPlayers} players today`;
    if (lb.you && !lb.entries.some((e) => e.username === lb.you!.username)) {
      const li = document.createElement('li');
      li.className = 'you';
      li.innerHTML = `<span class="lb-rank">${lb.you.rank}</span><span class="lb-name">u/${lb.you.username} (you)</span><span class="lb-score">${lb.you.strokes}</span>`;
      el('leaderboard-list').appendChild(li);
    }
  } catch (err) {
    console.error('leaderboard load failed', err);
  }
}

function retry() {
  el('result-overlay').classList.add('hidden');
  if (game && init && runtimeMap) {
    game.scene.stop('game');
    game.scene.start('game', sceneData());
  }
}

function wireUi() {
  el('btn-retry').addEventListener('click', retry);
  el('btn-leaderboard').addEventListener('click', () => {
    el('leaderboard-panel').classList.toggle('open');
    void loadLeaderboard();
  });
  el('btn-lb-close').addEventListener('click', () =>
    el('leaderboard-panel').classList.remove('open')
  );

  // Zoom controls: forward clicks to the running GameScene via game events.
  el('btn-zoom-in').addEventListener('click', () =>
    game?.events.emit('zoom-in')
  );
  el('btn-zoom-out').addEventListener('click', () =>
    game?.events.emit('zoom-out')
  );
}

async function main() {
  wireUi();
  try {
    const data = await apiClient.init();
    const map = await loadMap(data.mapId);
    startGame(data, map);
    void loadLeaderboard();
  } catch (err) {
    console.error('init failed', err);
    el('loading').textContent = 'Failed to load hole. Refresh to retry.';
  }
}

void main();
