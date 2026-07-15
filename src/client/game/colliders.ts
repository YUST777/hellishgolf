import Phaser from "phaser";
import type { World } from "@dimforge/rapier2d-compat";
import { BALL_FRICTION, PIXELS_PER_METER, TILE } from "./config";
import { RAPIER } from "./physics";
import type { CheckpointZone } from "./sceneTypes";
import type { RuntimeMap } from "../../shared/tiled";
import {
  cleanGid,
  isCheckpointGroundId,
  isFlagId,
  rampShapeOfId,
  roleOfGid,
  type RampShape,
} from "../../shared/tiles";

/**
 * Static physics geometry built from the Tiled map: greedy-meshed cuboids for
 * solid tiles, triangle colliders for ramps, and the sensor rectangles
 * (water/lava, rough, checkpoints, finish) tested per-frame in GameScene.
 */

export type ColliderBuild = {
  waterRects: Phaser.Geom.Rectangle[];
  roughRects: Phaser.Geom.Rectangle[];
  checkpointZones: CheckpointZone[];
  finishZone: Phaser.Geom.Rectangle;
  startPos: Phaser.Math.Vector2;
};

type BuildDeps = {
  map: RuntimeMap;
  world: World;
  /** Every static collider handle lands here for grounded/bounce checks. */
  groundHandles: Set<number>;
  /** Resolves a checkpoint zone to its nearest flag sprite + rank. */
  nearestFlagTarget: (
    x: number,
    y: number,
  ) => { point: Phaser.Math.Vector2; rank: number };
};

const pxToM = (px: number) => px / PIXELS_PER_METER;

function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

export function buildColliders(deps: BuildDeps): ColliderBuild {
  const { map } = deps;
  const { cols, rows, gids } = map;
  const waterRects: Phaser.Geom.Rectangle[] = [];
  const roughRects: Phaser.Geom.Rectangle[] = [];

  // Solid, non-ramp cells: greedy-mesh into big cuboids for smooth rolling.
  const solidKind: string[] = new Array(cols * rows).fill("");
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const gid = gids[row * cols + col] ?? 0;
      if (gid <= 0) continue;
      const id = cleanGid(gid) - 1;
      if (rampShapeOfId(id)) continue; // ramps handled as triangles below
      // Flags are decorations/sensors, never terrain. Only the platform
      // tiles around them should create Rapier colliders.
      if (isFlagId(id)) continue;
      const role = roleOfGid(gid);
      const solid =
        role === "ground" ||
        role === "ice" ||
        role === "finish" ||
        role === "checkpoint";
      if (solid) solidKind[row * cols + col] = role === "ice" ? "ice" : "solid";
    }
  }

  const used: boolean[] = new Array(cols * rows).fill(false);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const kind = solidKind[idx];
      if (!kind || used[idx]) continue;

      let w = 1;
      while (
        col + w < cols &&
        solidKind[row * cols + col + w] === kind &&
        !used[row * cols + col + w]
      )
        w++;

      let h = 1;
      outer: while (row + h < rows) {
        for (let k = 0; k < w; k++) {
          const j = (row + h) * cols + col + k;
          if (solidKind[j] !== kind || used[j]) break outer;
        }
        h++;
      }
      for (let r = 0; r < h; r++)
        for (let k = 0; k < w; k++) used[(row + r) * cols + col + k] = true;

      const isIce = kind === "ice";
      const cx = col * TILE + (w * TILE) / 2;
      const cy = row * TILE + (h * TILE) / 2;
      addStaticCuboid(
        deps,
        cx,
        cy,
        w * TILE,
        h * TILE,
        isIce ? 0.005 : BALL_FRICTION,
      );
    }
  }

  // Ramps: true triangle colliders in the correct orientation.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const gid = gids[row * cols + col] ?? 0;
      if (gid <= 0) continue;
      const id = cleanGid(gid) - 1;
      const shape = rampShapeOfId(id);
      if (shape) addRamp(deps, col, row, shape);
    }
  }

  // Sensors + finish zone.
  const checkpointMask: boolean[] = new Array(cols * rows).fill(false);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const gid = gids[row * cols + col] ?? 0;
      if (gid <= 0) continue;
      const id = cleanGid(gid) - 1;
      const role = roleOfGid(gid);
      const { x, y } = cellCenter(col, row);
      const rect = new Phaser.Geom.Rectangle(
        x - TILE / 2,
        y - TILE / 2,
        TILE,
        TILE,
      );
      if (role === "water") waterRects.push(rect);
      else if (role === "rough") roughRects.push(rect);
      if (isCheckpointGroundId(id)) checkpointMask[row * cols + col] = true;
    }
  }
  const checkpointZones = buildCheckpointZones(deps, checkpointMask);

  const f = cellCenter(map.finish.col, map.finish.row);
  const finishZone = new Phaser.Geom.Rectangle(
    f.x - TILE,
    f.y - TILE * 1.5,
    TILE * 2,
    TILE * 2.5,
  );

  const sp = cellCenter(map.spawn.col, map.spawn.row);
  const startPos = new Phaser.Math.Vector2(sp.x, sp.y - TILE * 0.5);

  return { waterRects, roughRects, checkpointZones, finishZone, startPos };
}

function buildCheckpointZones(
  deps: BuildDeps,
  checkpointMask: boolean[],
): CheckpointZone[] {
  const { cols, rows } = deps.map;
  const zones: CheckpointZone[] = [];
  const padX = TILE * 0.45;
  const topPad = TILE * 1.25;
  const bottomPad = TILE * 0.4;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!checkpointMask[row * cols + col]) continue;

      const startCol = col;
      while (col + 1 < cols && checkpointMask[row * cols + col + 1]) col++;
      const endCol = col;
      const width = (endCol - startCol + 1) * TILE;
      const zoneCenter = new Phaser.Math.Vector2(
        startCol * TILE + width / 2,
        row * TILE - TILE / 2,
      );
      const target = deps.nearestFlagTarget(zoneCenter.x, zoneCenter.y);

      zones.push({
        key: `${startCol}-${endCol},${row}`,
        row,
        startCol,
        endCol,
        rank: target.rank,
        respawn: target.point,
        rect: new Phaser.Geom.Rectangle(
          startCol * TILE - padX,
          row * TILE - topPad,
          width + padX * 2,
          TILE + topPad + bottomPad,
        ),
      });
    }
  }

  return zones;
}

function addStaticCuboid(
  deps: BuildDeps,
  cxPx: number,
  cyPx: number,
  wPx: number,
  hPx: number,
  friction: number,
) {
  const desc = RAPIER.ColliderDesc.cuboid(pxToM(wPx) / 2, pxToM(hPx) / 2)
    .setTranslation(pxToM(cxPx), pxToM(cyPx))
    .setRestitution(0.12)
    .setFriction(friction);
  const collider = deps.world.createCollider(desc);
  deps.groundHandles.add(collider.handle);
}

function addRamp(deps: BuildDeps, col: number, row: number, shape: RampShape) {
  const x0 = pxToM(col * TILE);
  const y0 = pxToM(row * TILE);
  const s = pxToM(TILE);
  // Triangle corners per orientation (physics y grows downward like screen).
  let a: { x: number; y: number };
  let b: { x: number; y: number };
  let c: { x: number; y: number };
  switch (shape) {
    case "ground-up": // slope rising to the right, solid below
      a = { x: x0, y: y0 + s };
      b = { x: x0 + s, y: y0 + s };
      c = { x: x0 + s, y: y0 };
      break;
    case "ground-down": // slope falling to the right, solid below
      a = { x: x0, y: y0 };
      b = { x: x0, y: y0 + s };
      c = { x: x0 + s, y: y0 + s };
      break;
    case "ceiling-up": // slope on the ceiling, solid above
      a = { x: x0, y: y0 };
      b = { x: x0 + s, y: y0 };
      c = { x: x0, y: y0 + s };
      break;
    case "ceiling-down":
      a = { x: x0, y: y0 };
      b = { x: x0 + s, y: y0 };
      c = { x: x0 + s, y: y0 + s };
      break;
  }
  const desc = RAPIER.ColliderDesc.triangle(a, b, c)
    .setRestitution(0.12)
    .setFriction(BALL_FRICTION);
  const collider = deps.world.createCollider(desc);
  deps.groundHandles.add(collider.handle);
}
