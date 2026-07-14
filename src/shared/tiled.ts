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
  finishFlagGid,
  checkpointFlagGid,
} from "./tiles";

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
  metadata?: {
    checkpointOrder?: Array<{ x: number; y: number }>;
  };
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
  /** Checkpoint flags in climb/progression order, lowest/earliest first. */
  checkpointOrder: RuntimeCell[];
}

function gidAt(gids: number[], cols: number, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= cols) return 0;
  return gids[row * cols + col] ?? 0;
}

/** Parse a Tiled JSON map into the runtime model. */
export function parseTiledMap(json: TiledMapJson): RuntimeMap {
  const cols = json.width;
  const rows = json.height;
  // Some mirrored maps omit `type: "tilelayer"` on the layer (just a named
  // "terrain" layer with a data array). Match by the presence of a numeric
  // data array so those holes aren't parsed as empty.
  const tileLayer = json.layers.find(
    (l) => Array.isArray(l.data) && l.data.length > 0,
  );
  const raw = tileLayer?.data ?? [];
  const gids = raw.map((v) => v & FLIP_MASK);

  const checkpoints: RuntimeCell[] = [];
  const finishFlagCells: RuntimeCell[] = [];
  const finishGroundCells: RuntimeCell[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const gid = gids[row * cols + col] ?? 0;
      if (gid <= 0) continue;
      const id = gid - 1;
      if (id === checkpointFlagGid) {
        checkpoints.push({ col, row });
      }
      if (id === finishFlagGid) finishFlagCells.push({ col, row });
      if (finishGidSet.has(id)) finishGroundCells.push({ col, row });
    }
  }

  // Anchor the finish on the finish flag when present; otherwise fall back to
  // the finish-ground cluster, then the map centre.
  const anchorFrom = (cells: RuntimeCell[]): RuntimeCell | null => {
    if (cells.length === 0) return null;
    const minRow = Math.min(...cells.map((c) => c.row));
    const top = cells.filter((c) => c.row === minRow);
    const avgCol = Math.round(top.reduce((s, c) => s + c.col, 0) / top.length);
    return { col: avgCol, row: minRow };
  };
  const finish: RuntimeCell = anchorFrom(finishFlagCells) ??
    anchorFrom(finishGroundCells) ?? { col: Math.floor(cols / 2), row: 1 };

  const spawn = deriveSpawn(gids, cols, rows, finish);
  const checkpointOrder = deriveCheckpointOrder(json, checkpoints);

  return {
    cols,
    rows,
    tileW: json.tilewidth,
    tileH: json.tileheight,
    gids,
    finish,
    spawn,
    checkpoints,
    checkpointOrder,
  };
}

function deriveCheckpointOrder(
  json: TiledMapJson,
  checkpoints: RuntimeCell[],
): RuntimeCell[] {
  const order = json.metadata?.checkpointOrder;
  if (Array.isArray(order) && order.length > 0) {
    return order
      .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y))
      .map((c) => ({ col: c.x, row: c.y }));
  }

  // Older mirrored maps do not carry metadata. They climb toward the top, so
  // lower rows are earlier checkpoints and smaller rows are later progress.
  return [...checkpoints].sort((a, b) => b.row - a.row || a.col - b.col);
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
  finish: RuntimeCell,
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
        belowRole === "ground" ||
        belowRole === "ice" ||
        belowRole === "ramp-up" ||
        belowRole === "ramp-down";
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
