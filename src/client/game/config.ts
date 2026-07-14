/** Visual and Rapier constants extracted from the mirrored game bundle. */

/** Native atlas frame size and rendered world tile size. */
export const SOURCE_TILE = 16;
export const TILE = 32;
export const TILESET_URL = 'game/tilemap/tileset.png';
export const DIRT_FRAME = 34;

/** The original renders Rapier metres at 50 screen pixels per metre. */
export const PIXELS_PER_METER = 50;
export const PHYSICS_TIMESTEP = 1 / 180;
export const GRAVITY_Y = 33;

/** Original ball/body values. */
export const BALL_RADIUS_METERS = 0.3;
export const BALL_RADIUS = BALL_RADIUS_METERS * PIXELS_PER_METER;
export const BALL_RESTITUTION = 0.86;
export const BALL_FRICTION = 0.1;
export const BALL_LINEAR_DAMPING = 0.4;
export const BALL_SLOW_DAMPING = 0.1;
export const BALL_ANGULAR_DAMPING = 15;
export const REST_SPEED = 0.5;

/** Original slingshot curve and limits. */
export const MAX_DRAG = 150;
export const MAX_LAUNCH_SPEED = 150;
export const POWER_EXP = 1.2;

/** The reference uses three discrete, persisted zoom choices. */
export const ZOOM_STORAGE_KEY = 'khg_default_zoom';
export const ZOOM_LEVELS = [1, 0.5, 0.35] as const;
export const DEFAULT_ZOOM = 1;

/** HellishGolf lava palette: dark volcanic sky glowing toward the horizon. */
export const COLORS = {
  skyTop: 0x1a0603,
  skyBottom: 0x8a2410,
  dirt: 0x241010,
  checkpoint: 0xffa53d,
  aim: 0xffffff,
  aimPower: 0xff5a1e,
} as const;
