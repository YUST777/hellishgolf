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
export const BALL_ANGULAR_DAMPING = 15;
export const REST_SPEED = 0.5;

/**
 * Settle model from the bundle: when the ball is slow AND grounded, damping is
 * raised and restitution dropped so it comes to rest instead of bouncing on.
 */
export const BALL_SLOW_SPEED = 0.8; // m/s threshold for "slow"
export const BALL_SETTLE_DAMPING = 4;
export const BALL_SETTLE_RESTITUTION = 0.3;

/**
 * Original slingshot curve and limits. The bundle launches with
 *   velocity = dir * pow(power, 1.2) * md * (Se / me)
 * where md=150, Se=15, me=50 (px per metre) -> effective scale 150*15/50 = 45.
 */
export const MAX_DRAG = 150;
export const MAX_LAUNCH_SPEED = 45;
export const POWER_EXP = 1.2;

/** Visual ball radius (px). The bundle draws the ball slightly larger (18)
 *  than its 0.3m physics collider (15px). */
export const BALL_VISUAL_RADIUS = 18;

/** The reference uses three discrete, persisted zoom choices. */
export const ZOOM_STORAGE_KEY = 'khg_default_zoom';
export const ZOOM_LEVELS = [1, 0.5, 0.35] as const;
export const DEFAULT_ZOOM = 1;

/** Kinda Infuriating Mode: disables checkpoints for a harder run. */
export const INFURIATING_STORAGE_KEY = 'khg_infuriating';

/** The daily hole rolls over at 05:00 UTC (matches the devvit scheduler cron). */
export const DAILY_RESET_HOUR_UTC = 5;

/** HellishGolf lava palette: dark volcanic sky glowing toward the horizon. */
export const COLORS = {
  skyTop: 0x1a0603,
  skyBottom: 0x8a2410,
  dirt: 0x241010,
  checkpoint: 0xffa53d,
  aim: 0xffffff,
  aimPower: 0xff5a1e,
} as const;
