import type Phaser from "phaser";

/** Shared shapes used by GameScene and its extracted subsystems. */

export type CheckpointZone = {
  rect: Phaser.Geom.Rectangle;
  key: string;
  row: number;
  startCol: number;
  endCol: number;
  rank: number;
  respawn: Phaser.Math.Vector2;
};

export type CheckpointFlagMarker = {
  sprite: Phaser.GameObjects.Image;
  rank: number;
};

export type CoinPickup = {
  id: string;
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
};

export type SlimePatch = {
  circle: Phaser.Geom.Circle;
  gfx: Phaser.GameObjects.Graphics;
};

export type LaunchVector = {
  raw: number;
  power: number;
  dir: Phaser.Math.Vector2;
  velocityX: number;
  velocityY: number;
};
