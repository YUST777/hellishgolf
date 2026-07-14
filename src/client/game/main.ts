import Phaser from 'phaser';
import { GameScene } from './GameScene';
import {
  DEFAULT_ZOOM,
  TILESET_URL,
  ZOOM_LEVELS,
  ZOOM_STORAGE_KEY,
} from './config';
import { apiClient } from './api';
import { ensureRapier } from './physics';
import { sound } from './sound';
import { mapUrl } from '../../shared/mapManifest';
import { parseTiledMap, type RuntimeMap } from '../../shared/tiled';
import { TILESET } from '../../shared/tiles';
import type { InitResponse, LeaderboardResponse } from '../../shared/types';

/** Read the persisted discrete zoom preference (defaults to 1). */
function readZoom(): number {
  const raw = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
  return (ZOOM_LEVELS as readonly number[]).includes(raw) ? raw : DEFAULT_ZOOM;
}

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
    zoom: readZoom(),
    onStroke: (n: number) => setHud(n, init?.bestToday ?? null, init?.streak ?? 0),
    // The checkpoint banner is driven by the 'checkpoint-reached' scene event.
    onCheckpoint: () => {},
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
    backgroundColor: '#1a0603',
    pixelArt: true,
    // Physics is the real Rapier engine, stepped manually inside GameScene.
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
      li.className = you ? 'leaderboard-entry you' : 'leaderboard-entry';
      li.innerHTML = `<span class="leaderboard-rank">${e.rank}</span><span class="leaderboard-username">u/${e.username}</span><span class="leaderboard-score">${e.strokes}</span>`;
      list.appendChild(li);
    }
    el('lb-total').textContent = `${lb.totalPlayers} players today`;
    if (lb.you && !lb.entries.some((e) => e.username === lb.you!.username)) {
      const li = document.createElement('li');
      li.className = 'leaderboard-entry you';
      li.innerHTML = `<span class="leaderboard-rank">${lb.you.rank}</span><span class="leaderboard-username">u/${lb.you.username} (you)</span><span class="leaderboard-score">${lb.you.strokes}</span>`;
      el('leaderboard-list').appendChild(li);
    }
  } catch (err) {
    console.error('leaderboard load failed', err);
  }
}

function show(id: string) {
  el(id).classList.remove('hidden');
}
function hide(id: string) {
  el(id).classList.add('hidden');
}

function retry() {
  hide('result-overlay');
  hide('menu-overlay');
  hide('reset-overlay');
  el('return-button').classList.remove('show');
  if (game && init && runtimeMap) {
    game.scene.stop('game');
    game.scene.start('game', sceneData());
  }
}

/** Reflect the current mute state onto both the HUD icon and settings button. */
function paintSound() {
  const muted = sound.isMuted();
  const muteBtn = el('btn-mute');
  muteBtn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
  const sBtn = document.getElementById('settings-sound');
  if (sBtn) sBtn.textContent = muted ? 'Off' : 'On';
}

/** Highlight the active discrete zoom choice in Settings. */
function paintZoomChoices() {
  const current = readZoom();
  el('zoom-choices')
    .querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.zoom) === current);
    });
}

function toggleSound() {
  sound.init();
  sound.setMuted(!sound.isMuted());
  paintSound();
}

function openLeaderboard() {
  show('leaderboard-overlay');
  void loadLeaderboard();
}

function wireUi() {
  // Result modal.
  el('btn-retry').addEventListener('click', retry);
  el('btn-result-leaderboard').addEventListener('click', openLeaderboard);

  // Menu.
  el('btn-menu').addEventListener('click', () => {
    sound.play('Back', 0.5);
    show('menu-overlay');
  });
  el('btn-menu-close').addEventListener('click', () => hide('menu-overlay'));
  el('menu-resume').addEventListener('click', () => hide('menu-overlay'));
  el('menu-leaderboard').addEventListener('click', () => {
    hide('menu-overlay');
    openLeaderboard();
  });
  el('menu-settings').addEventListener('click', () => {
    hide('menu-overlay');
    paintZoomChoices();
    paintSound();
    show('settings-overlay');
  });
  el('menu-return').addEventListener('click', () => {
    hide('menu-overlay');
    game?.events.emit('return-checkpoint');
  });
  el('menu-reset').addEventListener('click', () => {
    hide('menu-overlay');
    show('reset-overlay');
  });

  // Reset confirmation.
  el('reset-confirm').addEventListener('click', retry);
  el('reset-cancel').addEventListener('click', () => hide('reset-overlay'));

  // Settings.
  el('btn-settings-close').addEventListener('click', () =>
    hide('settings-overlay')
  );
  el('settings-sound').addEventListener('click', toggleSound);
  el('zoom-choices')
    .querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => {
      b.addEventListener('click', () => {
        const z = Number(b.dataset.zoom);
        localStorage.setItem(ZOOM_STORAGE_KEY, String(z));
        game?.events.emit('zoom-set', z);
        paintZoomChoices();
      });
    });

  // Leaderboard modal.
  el('btn-leaderboard').addEventListener('click', openLeaderboard);
  el('btn-lb-close').addEventListener('click', () => hide('leaderboard-overlay'));

  // Return-to-checkpoint floating button.
  el('return-button').addEventListener('click', () =>
    game?.events.emit('return-checkpoint')
  );

  // Zoom controls forward to the scene.
  el('btn-zoom-in').addEventListener('click', () => game?.events.emit('zoom-in'));
  el('btn-zoom-out').addEventListener('click', () =>
    game?.events.emit('zoom-out')
  );

  // Mute toggle.
  paintSound();
  el('btn-mute').addEventListener('click', toggleSound);
}

/** Bridge scene events to the DOM shell once the game exists. */
function wireGameEvents() {
  if (!game) return;
  game.events.on('zoom-changed', (z: number) => {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(z));
    paintZoomChoices();
  });
  // Reveal the return button + banner once a checkpoint is reached.
  game.events.on('checkpoint-reached', () => {
    el('return-button').classList.add('show');
    const alert = el('checkpoint-alert');
    alert.classList.add('show');
    window.setTimeout(() => alert.classList.remove('show'), 1600);
  });
}

async function main() {
  wireUi();
  try {
    // Load the Rapier engine (WASM) and the hole data in parallel.
    const [data] = await Promise.all([apiClient.init(), ensureRapier()]);
    const map = await loadMap(data.mapId);
    startGame(data, map);
    wireGameEvents();
    void loadLeaderboard();
  } catch (err) {
    console.error('init failed', err);
    el('loading').textContent = 'Failed to load hole. Refresh to retry.';
  }
}

void main();
