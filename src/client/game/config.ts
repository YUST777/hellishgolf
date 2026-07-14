/** Shared visual + physics constants for the Phaser client. */

/** Native tile size of the mirrored Kinda Hard Golf tileset (16px). */
export const TILE = 16;

/** Public URL of the mirrored tileset atlas (served from the client bundle). */
export const TILESET_URL = 'game/tilemap/tileset.png';

/**
 * Atlas frame index of the solid dirt/earth block (the dominant fill tile in
 * the real maps, gid 35 => frame 34). Used to tile the world backdrop so the
 * area behind/around the hole is filled with the game's own dirt texture.
 */
export const DIRT_FRAME = 34;

/** Default camera zoom so 16px tiles read at a comfortable size. */
export const ZOOM = 2.5;

/** Zoom limits + step for the in-game zoom controls (wheel / pinch / buttons). */
export const ZOOM_MIN = 1.0;
export const ZOOM_MAX = 5.0;
export const ZOOM_STEP = 0.25;

/** Ball radius in pixels (world space, ~0.4 tile). */
export const BALL_RADIUS = 6;

/**
 * Max drag distance in WORLD px that maps to max launch power. The ball is the
 * anchor; you pull back from it and release. ~6 tiles of pull = full power.
 */
export const MAX_DRAG = 96;

/**
 * Max speed the ball may travel, in px per physics step. Matter has no true
 * CCD, so tunneling is prevented by ensuring the ball never moves further than
 * roughly one tile (TILE px) between steps. Keep MAX_SPEED < TILE.
 */
export const MAX_SPEED = 12;

/**
 * Physics values mirrored from the real Kinda Hard Golf bundle (which uses
 * Rapier at 50 px/meter with gravity y=33). Translated to our Matter setup:
 *   - BALL_RESTITUTION: how bouncy the ball is off walls (real game: 0.86).
 *   - BALL_FRICTION / BALL_FRICTION_AIR: rolling + air damping (real: linear
 *     damping 0.4, angular damping 15 => low surface friction, noticeable air
 *     drag so the ball settles instead of rolling forever).
 *   - GRAVITY_Y: downward accel in Matter units, tuned to feel like the real
 *     game's snappy fall at our pixel scale.
 *   - POWER_EXP: the launch power curve exponent (real game: pow(power, 1.2)),
 *     so short pulls are gentle and long pulls ramp up hard.
 */
export const BALL_RESTITUTION = 0.86;
export const BALL_FRICTION = 0.02;
export const BALL_FRICTION_AIR = 0.012;
export const GRAVITY_Y = 1.0;
export const POWER_EXP = 1.2;

/** Speed below which the ball is considered at rest (px/step). */
export const REST_SPEED = 0.35;

/** Palette pulled to echo the reference game's cheerful sky/turf look. */
export const COLORS = {
  skyTop: 0x1f79cd,
  skyBottom: 0x4e99df,
  turf: 0x16a34a,
  turfDark: 0x0f7a34,
  dirt: 0x6b4423,
  dirtDark: 0x4d2f18,
  wall: 0x8b5a2b,
  wallEdge: 0x633f1d,
  sand: 0xf5e5bd,
  hazard: 0xd8353a,
  bouncer: 0xf59e0b,
  checkpoint: 0xfddf6a,
  cup: 0x111827,
  ball: 0xffffff,
  ballShadow: 0x000000,
  aim: 0xffffff,
  aimPower: 0xfddf6a,
} as const;
