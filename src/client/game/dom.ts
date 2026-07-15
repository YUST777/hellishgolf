/** Small DOM helpers shared by the HUD, shop, and leaderboard modules. */

export const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

export function textIfPresent(id: string, value: string) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

export function show(id: string) {
  el(id).classList.remove("hidden");
}

export function hide(id: string) {
  el(id).classList.add("hidden");
}

let toastTimer: number | null = null;

export function toast(message: string) {
  const node = el("toast");
  node.textContent = message;
  node.classList.add("show");
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("show"), 1500);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
