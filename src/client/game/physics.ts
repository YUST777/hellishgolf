/**
 * Rapier bootstrap. The real Kinda Hard Golf runs the Rapier 2D engine, so we
 * load the same engine (WASM) once and share the module singleton. `ensureRapier`
 * must be awaited before any physics world is created.
 */
import RAPIER from "@dimforge/rapier2d-compat";

let ready: Promise<typeof RAPIER> | null = null;

export function ensureRapier(): Promise<typeof RAPIER> {
  if (!ready) {
    ready = RAPIER.init().then(() => RAPIER);
  }
  return ready;
}

export { RAPIER };
