import Phaser from "phaser";
import type { Collider, RigidBody, World } from "@dimforge/rapier2d-compat";
import {
  BALL_LINEAR_DAMPING,
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_SETTLE_DAMPING,
  BALL_SETTLE_RESTITUTION,
  BALL_SLOW_SPEED,
  PHYSICS_TIMESTEP,
  PIXELS_PER_METER,
  REST_SPEED,
  TILE,
} from "./config";
import type { SlimePatch } from "./sceneTypes";

/**
 * Trajectory powerup prediction: steps a snapshot copy of the Rapier world
 * forward, mirroring the live settle model and the water/rough/slime sensors,
 * and returns the sampled preview points.
 */

const TRAJECTORY_PREVIEW_SECONDS = 4.2;
const TRAJECTORY_SAMPLE_STEPS = 9;
const TRAJECTORY_SENSOR_STEPS = Math.max(
  1,
  Math.round(1 / 60 / PHYSICS_TIMESTEP),
);

type PredictionStop = "water" | "slime" | "bounds" | null;

/** The live-scene facts the prediction has to mirror. */
export type TrajectoryEnv = {
  groundHandles: Set<number>;
  waterRects: Phaser.Geom.Rectangle[];
  roughRects: Phaser.Geom.Rectangle[];
  slimePatches: SlimePatch[];
  worldW: number;
  worldH: number;
};

export function predictTrajectoryPoints(
  env: TrajectoryEnv,
  world: World,
  body: RigidBody,
  collider: Collider,
): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = [];
  const maxSteps = Math.round(TRAJECTORY_PREVIEW_SECONDS / PHYSICS_TIMESTEP);

  for (let step = 1; step <= maxSteps; step++) {
    applySettleModel(env, world, body, collider);
    world.step();

    const pos = body.translation();
    const x = pos.x * PIXELS_PER_METER;
    const y = pos.y * PIXELS_PER_METER;

    if (step % TRAJECTORY_SAMPLE_STEPS === 0) {
      points.push(new Phaser.Math.Vector2(x, y));
    }

    if (step % TRAJECTORY_SENSOR_STEPS === 0) {
      const stop = applySensors(env, body, x, y);
      if (stop) break;
    }

    if (outOfBounds(env, x, y)) break;
    if (
      step > TRAJECTORY_SENSOR_STEPS &&
      isResting(env, world, body, collider)
    ) {
      if (step % TRAJECTORY_SAMPLE_STEPS !== 0) {
        points.push(new Phaser.Math.Vector2(x, y));
      }
      break;
    }
  }

  return points;
}

function applySettleModel(
  env: TrajectoryEnv,
  world: World,
  body: RigidBody,
  collider: Collider,
) {
  const v = body.linvel();
  const slow = Math.hypot(v.x, v.y) < BALL_SLOW_SPEED;
  const settle = slow && isGrounded(env, world, collider);
  body.setLinearDamping(settle ? BALL_SETTLE_DAMPING : BALL_LINEAR_DAMPING);
  collider.setRestitution(settle ? BALL_SETTLE_RESTITUTION : BALL_RESTITUTION);
}

function isGrounded(
  env: TrajectoryEnv,
  world: World,
  collider: Collider,
): boolean {
  let grounded = false;
  world.contactPairsWith(collider, (other) => {
    if (env.groundHandles.has(other.handle)) grounded = true;
  });
  return grounded;
}

function isResting(
  env: TrajectoryEnv,
  world: World,
  body: RigidBody,
  collider: Collider,
): boolean {
  const v = body.linvel();
  return Math.hypot(v.x, v.y) < REST_SPEED && isGrounded(env, world, collider);
}

function applySensors(
  env: TrajectoryEnv,
  body: RigidBody,
  x: number,
  y: number,
): PredictionStop {
  const ballCircle = new Phaser.Geom.Circle(x, y, BALL_RADIUS * 0.7);
  for (const r of env.waterRects) {
    if (Phaser.Geom.Intersects.CircleToRectangle(ballCircle, r)) return "water";
  }

  for (const r of env.roughRects) {
    if (Phaser.Geom.Rectangle.Contains(r, x, y)) {
      const v = body.linvel();
      body.setLinvel({ x: v.x * 0.9, y: v.y * 0.94 }, true);
      break;
    }
  }

  const stickyCircle = new Phaser.Geom.Circle(x, y, BALL_RADIUS * 1.05);
  for (const patch of env.slimePatches) {
    if (Phaser.Geom.Intersects.CircleToCircle(stickyCircle, patch.circle)) {
      body.setLinvel({ x: 0, y: 0 }, true);
      body.setAngvel(0, true);
      return "slime";
    }
  }

  return null;
}

function outOfBounds(env: TrajectoryEnv, x: number, y: number): boolean {
  return (
    x < -TILE || x > env.worldW + TILE || y < -TILE || y > env.worldH + 400
  );
}
