/**
 * The set of real Kinda Hard Golf daily maps mirrored into
 * public/game/tilemap/. The daily hole is chosen deterministically from this
 * pool by date, so every player sees the same real hole each day.
 */
export const MAP_IDS: number[] = [
  1, 2, 450, 451, 452, 453, 454, 455, 456, 457, 458, 459, 460, 461, 462, 463,
  464, 465, 466, 467, 468, 469, 470,
];

/** Public URL (served from the client bundle) for a given map id. */
export function mapUrl(id: number): string {
  return `game/tilemap/map-${id}.json`;
}

/** Pick a map id deterministically from a numeric seed. */
export function pickMapId(seed: number): number {
  const idx = (seed >>> 0) % MAP_IDS.length;
  return MAP_IDS[idx]!;
}
