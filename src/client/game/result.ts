import confetti from "canvas-confetti";
import { DAILY_RESET_HOUR_UTC } from "./config";
import { el } from "./dom";

/** Result modal: score card, win confetti, and the next-hole countdown. */

/** Milliseconds until the next daily hole rollover at 05:00 UTC. */
function msUntilNextHole(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(DAILY_RESET_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

let countdownTimer: number | null = null;

export function launchWinConfetti() {
  const common = {
    disableForReducedMotion: true,
    scalar: 1.1,
    ticks: 180,
    zIndex: 1000,
  } as const;

  void confetti({
    ...common,
    particleCount: 90,
    spread: 70,
    origin: { x: 0.5, y: 0.62 },
  });

  window.setTimeout(() => {
    void confetti({
      ...common,
      particleCount: 55,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.76 },
    });
    void confetti({
      ...common,
      particleCount: 55,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.76 },
    });
  }, 140);
}

export function showResult(
  strokes: number,
  timeMs: number,
  rank: number | null,
  total: number | null,
) {
  const overlay = el("result-overlay");
  overlay.classList.remove("hidden");
  el("result-strokes").textContent = String(strokes);
  el("result-time").textContent = `${(timeMs / 1000).toFixed(1)}s`;
  el("result-rank").textContent =
    rank && total ? `Rank ${rank} of ${total}` : "Submitting...";
  startCountdown();
}

/** Live "New hole in HH:MM:SS" countdown on the result modal. */
function startCountdown() {
  const tick = () => {
    let ms = msUntilNextHole();
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    el("result-countdown").textContent = `${hh}:${mm}:${ss}`;
  };
  tick();
  if (countdownTimer !== null) window.clearInterval(countdownTimer);
  countdownTimer = window.setInterval(tick, 1000);
}

export function stopCountdown() {
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
}
