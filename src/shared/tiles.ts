/**
 * Tile semantics extracted directly from the Kinda Hard Golf game bundle.
 *
 * Maps are Tiled JSON exports using a single tileset with firstgid = 1, so a
 * value `v` in the layer data corresponds to tileId = v - 1 (0 = empty).
 *
 * The original game classifies tiles like so (tileId values):
 *   spawn            = 209        (the tee / ball start)
 *   finish-flag      = 154        finish-ground = 111,112,113
 *   checkpoint-flag  = 153        checkpoint-ground = 166,167,168,265,266,267,200
 *   water (hazard)   = 176
 *   rough (sand)     = 496,497,498,499
 *   ice              = 103
 *   ramps            = 172 (up-ground) 173 (down-ground) 169 (up-ceiling) 202 (down-ceiling)
 *   birds (decor)    = 11..18
 * Everything else in the solid ground list collides.
 */

/** Named tile roles the game logic cares about. */
export type TileRole =
  | 'empty'
  | 'ground'
  | 'spawn'
  | 'finish'
  | 'checkpoint'
  | 'water'
  | 'rough'
  | 'ice'
  | 'ramp-up'
  | 'ramp-down'
  | 'bird';

// --- tileId constants (NOT gids) ------------------------------------------
export const T_SPAWN = 209;
export const T_FINISH_FLAG = 154;
export const T_CHECKPOINT_FLAG = 153;
export const T_WATER = 176;
export const T_ICE = 103;

export const T_ROUGH = [496, 497, 498, 499];
export const T_BIRDS = [11, 12, 13, 14, 15, 16, 17, 18];

export const T_FINISH_GROUND = [111, 112, 113];
export const T_CHECKPOINT_GROUND = [166, 167, 168, 265, 266, 267, 200];

export const T_RAMP_UP = [172, 169]; // up-ground, up-ceiling
export const T_RAMP_DOWN = [173, 202]; // down-ground, down-ceiling

/**
 * The core solid-ground tileId list from the bundle. These form the walls,
 * floors, and platforms the ball collides with.
 */
export const T_GROUND = [
  103, 35, 72, 102, 100, 139, 73, 135, 136, 137, 101, 140, 5, 8, 37, 71, 74, 2,
  68, 34, 36, 1, 3, 67, 69, 105, 39, 40, 104, 43, 7, 106, 107, 4, 41, 70, 42, 6,
  38, 110, 75, 109, 365, 211,
];

/** All tileIds that should collide (ground + ramps + flag-grounds). */
export const SOLID_TILE_IDS: number[] = Array.from(
  new Set<number>([
    ...T_GROUND,
    ...T_FINISH_GROUND,
    ...T_CHECKPOINT_GROUND,
    ...T_RAMP_UP,
    ...T_RAMP_DOWN,
  ])
);

const roughSet = new Set(T_ROUGH);
const birdSet = new Set(T_BIRDS);
const finishGroundSet = new Set(T_FINISH_GROUND);
const checkpointGroundSet = new Set(T_CHECKPOINT_GROUND);
const rampUpSet = new Set(T_RAMP_UP);
const rampDownSet = new Set(T_RAMP_DOWN);
const solidSet = new Set(SOLID_TILE_IDS);

export type RampShape =
  | 'ground-up'
  | 'ground-down'
  | 'ceiling-up'
  | 'ceiling-down';

/** Exact triangular collider orientation for each ramp tileId. */
export function rampShapeOfId(id: number): RampShape | null {
  if (id === 172) return 'ground-up';
  if (id === 173) return 'ground-down';
  if (id === 169) return 'ceiling-up';
  if (id === 202) return 'ceiling-down';
  return null;
}

/** Flags are sensors/decor; only this exact bundle list creates solid geometry. */
export function isSolidId(id: number): boolean {
  return solidSet.has(id);
}

/**
 * Tiled stores horizontal/vertical/diagonal flip flags in the top 3 bits of a
 * gid. Mask them off to recover the real gid.
 */
export const TILED_FLIP_MASK = 0x1fffffff;

/** Strip Tiled flip flags from a raw layer value. */
export function cleanGid(raw: number): number {
  return raw & TILED_FLIP_MASK;
}

/** Classify a bare tileId (gid - 1) into a gameplay role. */
export function roleOfId(id: number): TileRole {
  if (id < 0) return 'empty';
  if (id === T_SPAWN) return 'spawn';
  if (id === T_FINISH_FLAG || finishGroundSet.has(id)) return 'finish';
  if (id === T_CHECKPOINT_FLAG || checkpointGroundSet.has(id)) return 'checkpoint';
  if (id === T_WATER) return 'water';
  if (roughSet.has(id)) return 'rough';
  if (id === T_ICE) return 'ice';
  if (rampUpSet.has(id)) return 'ramp-up';
  if (rampDownSet.has(id)) return 'ramp-down';
  if (birdSet.has(id)) return 'bird';
  if (solidSet.has(id)) return 'ground';
  // Unknown non-empty tiles: treat as solid so unexpected art still blocks.
  return 'ground';
}

/** Classify a raw layer value (gid, may carry flip flags) into a role. */
export function roleOfGid(rawGid: number): TileRole {
  const gid = cleanGid(rawGid);
  if (gid <= 0) return 'empty';
  return roleOfId(gid - 1); // firstgid = 1
}

/** Whether a gid should produce a physics collider. */
export function isSolidGid(gid: number): boolean {
  const r = roleOfGid(gid);
  return (
    r === 'ground' ||
    r === 'ice' ||
    r === 'ramp-up' ||
    r === 'ramp-down' ||
    r === 'finish' ||
    r === 'checkpoint'
  );
}

/** The list of collidable gids (tileId + 1) for Phaser setCollision. */
export const SOLID_GIDS: number[] = SOLID_TILE_IDS.map((id) => id + 1);

/** Set of tileIds (NOT gids) that count as the finish (flag + ground). */
export const finishGidSet = new Set<number>([T_FINISH_FLAG, ...T_FINISH_GROUND]);

/** The checkpoint flag tileId (NOT gid). */
export const checkpointFlagGid = T_CHECKPOINT_FLAG;

/** Tileset atlas geometry (from tilemap/tileset.png = 528x400, 16px tiles). */
export const TILESET = {
  imageWidth: 528,
  imageHeight: 400,
  tileWidth: 16,
  tileHeight: 16,
  columns: 33,
  rows: 25,
} as const;
