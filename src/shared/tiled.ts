/**
 * Parser for the real Kinda Hard Golf Tiled maps (mirrored into
 * public/game/tilemap/). Converts the raw Tiled JSON into a runtime model the
 * Phaser scene can render + simulate: a grid of tile gids, the finish/cup
 * position, checkpoints, and a derived spawn (tee) point.
 */
import {
  TILESET,
  roleOfGid,
  finishGidSet,
  checkpointFlagGid,
} from './tiles';

/** Tiled sets these high bits for flipped/rotated tiles; mask them off. */
const FLIP_MASK = 0x1fffffff;

export interface TiledMapJson {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: Array<{
    type: string;
    data?: number[];
    width?: number;
    height?: number;
  }>;
}

export interface RuntimeCell {
  col: number;
  row: number;
}

export interface RuntimeMap {
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  /** Row-major grid of raw gids (0 = empty), flip bits stripped. */
  gids: number[];
  /** Cup / finish position (grid cell, top-left of the finish cluster). */
  finish: RuntimeCell;
  /** Ball spawn (tee) — derived: playable ground cell far from the finish. */
  spawn: RuntimeCell;
  /** Checkpoint flag cells. */
  checkpoints: RuntimeCell[];
}

function gidAt(gids: number[], cols: number, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= cols) return 0;
  return gids[row * cols + col] ?? 0;
}

/** Parse a Tiled JSON map into the runtime model. */
export function parseTiledMap(json: TiledMapJson): RuntimeMap {
  const cols = json.width;
  const rows = json.height;
  const tileLayer = json.layers.find((l) => l.type === 'tilelayer' && l.data);
  const raw = tileLayer?.data ?? [];
  const gids = raw.map((v) => v & FLIP_MASK);

  const checkpoints: RuntimeCell[] = [];
  const finishCells: RuntimeCell[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const gid = gids[row * cols + col] ?? 0;
      if (gid <= 0) continue;
      const id = gid - 1;
      if (id === checkpointFlagGid) checkpoints.push({ col, row });
      if (finishGidSet.has(id)) finishCells.push({ col, row });
    }
  }

  // Finish = centroid-ish top of the finish-ground cluster.
  let finish: RuntimeCell;
  if (finishCells.length > 0) {
    const minRow = Math.min(...finishCells.map((c) => c.row));
    const top = finishCells.filter((c) => c.row === minRow);
    const avgCol = Math.round(
      top.reduce((s, c) => s + c.col, 0) / top.length
    );
    finish = { col: avgCol, row: minRow };
  } else {
    finish = { col: Math.floor(cols / 2), row: 1 };
  }

  const spawn = deriveSpawn(gids, cols, rows, finish);

  return {
    cols,
    rows,
    tileW: json.tilewidth,
    tileH: json.tileheight,
    gids,
    finish,
    spawn,
    checkpoints,
  };
}

/**
 * Daily maps don't carry an explicit spawn tile, so we derive one: find open
 * cells that sit directly on top of solid ground (a standable spot) and choose
 * the one furthest from the finish. That reproduces the "start far, climb to
 * the flag" flow of the original without needing the level-editor metadata.
 */
function deriveSpawn(
  gids: number[],
  cols: number,
  rows: number,
  finish: RuntimeCell
): RuntimeCell {
  const candidates: RuntimeCell[] = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols; col++) {
      const here = gidAt(gids, cols, col, row);
      const below = gidAt(gids, cols, col, row + 1);
      if (here !== 0) continue; // must be open space
      if (below === 0) continue; // must have something beneath
      const belowRole = roleOfGid(below);
      const isFloor =
        belowRole === 'ground' ||
        belowRole === 'ice' ||
        belowRole === 'ramp-up' ||
        belowRole === 'ramp-down';
      if (!isFloor) continue;
      candidates.push({ col, row });
    }
  }

  if (candidates.length === 0) {
    return { col: 1, row: rows - 2 };
  }

  let best = candidates[0]!;
  let bestDist = -1;
  for (const c of candidates) {
    const dx = c.col - finish.col;
    const dy = c.row - finish.row;
    const d = dx * dx + dy * dy;
    if (d > bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** Pixel geometry helpers shared by the renderer. */
export function tilesetFrameCount(): number {
  return TILESET.columns * TILESET.rows;
}
