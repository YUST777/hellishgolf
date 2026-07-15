import { MAX_COINS_PER_DAILY_MAP } from "./powerups";
import type { RuntimeMap } from "../../shared/tiled";
import { roleOfGid } from "../../shared/tiles";

/**
 * Deterministic daily coin placement: hash each standable air cell with the
 * date + map so every player sees the same coins, then greedily pick spread
 * out spots away from the spawn and finish.
 */

function gidAt(map: RuntimeMap, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return 0;
  return map.gids[row * map.cols + col] ?? 0;
}

/** FNV-1a over date/map/cell — the per-cell daily randomness source. */
export function hashCell(
  dateKey: string,
  mapId: number,
  col: number,
  row: number,
): number {
  const key = `${dateKey}:${mapId}:${col}:${row}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function cellDistanceSq(
  aCol: number,
  aRow: number,
  bCol: number,
  bRow: number,
): number {
  const dx = aCol - bCol;
  const dy = aRow - bRow;
  return dx * dx + dy * dy;
}

/** An empty cell directly above something the ball can rest on. */
function isStandableCoinCell(
  map: RuntimeMap,
  col: number,
  row: number,
): boolean {
  if (gidAt(map, col, row) !== 0) return false;
  const belowRole = roleOfGid(gidAt(map, col, row + 1));
  return (
    belowRole === "ground" ||
    belowRole === "ice" ||
    belowRole === "ramp-up" ||
    belowRole === "ramp-down" ||
    belowRole === "checkpoint"
  );
}

export function pickCoinSpots(
  map: RuntimeMap,
  dateKey: string,
  mapId: number,
): Array<{ col: number; row: number }> {
  const candidates: Array<{ col: number; row: number; hash: number }> = [];
  for (let row = 0; row < map.rows - 1; row++) {
    for (let col = 0; col < map.cols; col++) {
      if (!isStandableCoinCell(map, col, row)) continue;
      if (cellDistanceSq(col, row, map.spawn.col, map.spawn.row) < 18) {
        continue;
      }
      if (cellDistanceSq(col, row, map.finish.col, map.finish.row) < 12) {
        continue;
      }
      candidates.push({ col, row, hash: hashCell(dateKey, mapId, col, row) });
    }
  }

  candidates.sort((a, b) => a.hash - b.hash);
  const picked: Array<{ col: number; row: number }> = [];
  for (const c of candidates) {
    if (picked.some((p) => cellDistanceSq(c.col, c.row, p.col, p.row) < 36)) {
      continue;
    }
    picked.push({ col: c.col, row: c.row });
    if (picked.length >= MAX_COINS_PER_DAILY_MAP) break;
  }
  return picked;
}
