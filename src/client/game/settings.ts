import {
  DEFAULT_ZOOM,
  INFURIATING_STORAGE_KEY,
  ZOOM_LEVELS,
  ZOOM_STORAGE_KEY,
} from "./config";
import { el } from "./dom";
import { retry } from "./session";
import { sound } from "./sound";

/** Settings overlay state: zoom, sound, and Infuriating Mode toggles. */

/** Read the persisted discrete zoom preference (defaults to 1). */
export function readZoom(): number {
  const raw = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
  return (ZOOM_LEVELS as readonly number[]).includes(raw) ? raw : DEFAULT_ZOOM;
}

/** Read the persisted Infuriating Mode preference (checkpoints disabled). */
export function readInfuriating(): boolean {
  return localStorage.getItem(INFURIATING_STORAGE_KEY) === "true";
}

/** Reflect Infuriating Mode on the settings button and the title fire badge. */
export function paintInfuriating() {
  const on = readInfuriating();
  const btn = document.getElementById("settings-infuriating");
  if (btn) btn.textContent = on ? "On" : "Off";
  const badge = document.getElementById("infuriating-badge");
  if (badge) badge.style.display = on ? "inline" : "none";
}

export function toggleInfuriating() {
  const next = !readInfuriating();
  localStorage.setItem(INFURIATING_STORAGE_KEY, String(next));
  paintInfuriating();
  // Restart the hole so the checkpoint change takes effect immediately.
  retry();
}

/** Reflect the current mute state onto both the HUD icon and settings button. */
export function paintSound() {
  const muted = sound.isMuted();
  const muteBtn = el("btn-mute");
  muteBtn.classList.toggle("is-muted", muted);
  muteBtn.title = muted ? "Sound off" : "Sound on";
  muteBtn.setAttribute("aria-label", muted ? "Sound off" : "Sound on");
  const sBtn = document.getElementById("settings-sound");
  if (sBtn) sBtn.textContent = muted ? "Off" : "On";
}

export function toggleSound() {
  sound.init();
  sound.setMuted(!sound.isMuted());
  paintSound();
}

/** Highlight the active discrete zoom choice in Settings. */
export function paintZoomChoices() {
  const current = readZoom();
  el("zoom-choices")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.zoom) === current);
    });
}
