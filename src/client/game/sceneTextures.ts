import type Phaser from "phaser";
import {
  BALL_VISUAL_RADIUS,
  COLORS,
  DIRT_FRAME,
  SOURCE_TILE,
  TILE,
} from "./config";
import { getBallSkin, type BallSkinId } from "./powerups";

/** Procedurally generated textures and the padded backdrop for GameScene. */

/** Padded dirt backdrop + the checkerboard grid over the playable rectangle. */
export function drawSky(scene: Phaser.Scene, worldW: number, worldH: number) {
  const marginX = worldW + 2000;
  const marginY = worldH + 2000;
  const left = -marginX;
  const top = -marginY;
  const totalW = worldW + marginX * 2;
  const totalH = worldH + marginY * 2;

  // OUTER background = one textured dirt object across the padded backdrop.
  if (ensureDirtTexture(scene)) {
    scene.add
      .tileSprite(left, top, totalW, totalH, "dirt")
      .setOrigin(0, 0)
      .setDepth(-14);
  } else {
    scene.add
      .rectangle(left, top, totalW, totalH, COLORS.dirt)
      .setOrigin(0, 0)
      .setDepth(-14);
  }

  // INNER background = the checkerboard grid, filling ONLY the map rectangle
  // (the area the ball plays against), mirroring the original's grid backdrop.
  if (scene.textures.exists("checkerboard")) {
    const grid = scene.add
      .tileSprite(0, 0, worldW, worldH, "checkerboard")
      .setOrigin(0, 0)
      .setDepth(-12);
    grid.tileScaleX = 12.5;
    grid.tileScaleY = 12.5;
  }
}

/** Copy the dirt tile out of the tileset into its own tileable texture. */
function ensureDirtTexture(scene: Phaser.Scene): boolean {
  if (scene.textures.exists("dirt")) return true;
  if (!scene.textures.exists("tileset")) return false;
  const tex = scene.textures.get("tileset");
  const frame = tex.get(DIRT_FRAME);
  const source = tex.getSourceImage() as CanvasImageSource;
  if (!frame || !source) return false;
  const canvasTex = scene.textures.createCanvas("dirt", TILE, TILE);
  if (!canvasTex) return false;
  const ctx = canvasTex.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source,
    frame.cutX,
    frame.cutY,
    SOURCE_TILE,
    SOURCE_TILE,
    0,
    0,
    TILE,
    TILE,
  );
  canvasTex.refresh();
  return scene.textures.exists("dirt");
}

/** Small gold coin with a shadow, rim, and highlight. */
export function ensureCoinTexture(scene: Phaser.Scene) {
  if (scene.textures.exists("coin")) return;
  const size = 24;
  const c = size / 2;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(c + 2, c + 3, 18, 10);
  g.fillStyle(0x8a4b0f, 1);
  g.fillCircle(c, c, 10);
  g.fillStyle(0xffd65a, 1);
  g.fillCircle(c, c, 8);
  g.fillStyle(0xfff1a6, 0.95);
  g.fillCircle(c - 3, c - 4, 3);
  g.lineStyle(2, 0x6b3a09, 1);
  g.strokeCircle(c, c, 9);
  g.generateTexture("coin", size, size);
  g.destroy();
}

export function ballTextureKey(skinId: BallSkinId): string {
  return `hgball-${skinId}`;
}

/**
 * Build the ball texture to match the bundle: skin body (r=18) with a dark
 * outline, an offset drop shadow, a soft warm highlight upper-left, and a few
 * dimples. Drawn once into a reusable texture per skin.
 */
export function ensureBallTexture(scene: Phaser.Scene, skinId: BallSkinId) {
  const key = ballTextureKey(skinId);
  if (scene.textures.exists(key)) return;
  const skin = getBallSkin(skinId);
  const R = BALL_VISUAL_RADIUS;
  const pad = 6;
  const c = R + pad; // texture centre
  const size = c * 2;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  // Drop shadow (offset down-right).
  g.fillStyle(0x000000, 0.3);
  g.fillCircle(c + 3, c + 3, R);
  // Dark base ring / outline backing.
  g.fillStyle(0x000000, 0.7);
  g.fillCircle(c, c, R + 1);
  // Skin body.
  g.fillStyle(skin.body, 1);
  g.fillCircle(c, c, R);
  // Soft warm highlights upper-left (kept small so they stay on the ball).
  g.fillStyle(skin.highlight, 0.22);
  g.fillCircle(c - 6, c - 6, R * 0.55);
  g.fillStyle(skin.highlight, 0.18);
  g.fillCircle(c - 6.3, c - 6.3, R * 0.38);
  // Dimples.
  g.fillStyle(skin.dimple, 0.9);
  const dimples = [
    { x: 4, y: 6 },
    { x: -7, y: 3 },
    { x: 6, y: -4 },
    { x: -3, y: -8 },
    { x: 9, y: -2 },
    { x: -9, y: -3 },
    { x: 1, y: 10 },
  ];
  for (const d of dimples) g.fillCircle(c + d.x, c + d.y, 1.1);
  // Outline.
  g.lineStyle(2, skin.outline, 1);
  g.strokeCircle(c, c, R);

  g.generateTexture(key, size, size);
  g.destroy();
}

/** Little pennant flag on a pole for the player-generated checkpoint. */
export function ensureGeneratedCheckpointTexture(scene: Phaser.Scene) {
  if (scene.textures.exists("generated-checkpoint")) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.lineStyle(3, 0x3b2a14, 1);
  g.beginPath();
  g.moveTo(10, 42);
  g.lineTo(10, 8);
  g.strokePath();
  g.fillStyle(0xfff1a6, 1);
  g.fillTriangle(12, 9, 30, 15, 12, 23);
  g.lineStyle(2, 0x7c4a03, 1);
  g.strokeTriangle(12, 9, 30, 15, 12, 23);
  g.fillStyle(0x047857, 1);
  g.fillEllipse(10, 43, 18, 7);
  g.generateTexture("generated-checkpoint", 36, 48);
  g.destroy();
}
