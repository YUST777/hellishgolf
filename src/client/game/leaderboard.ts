import { apiClient } from "./api";
import { el, show } from "./dom";
import type { LeaderboardResponse } from "../../shared/types";

/** Daily leaderboard overlay: fetch, render, and open. */

function createLeaderboardRow(
  entry: LeaderboardResponse["entries"][number],
  currentUsername: string | null,
  labelAsYou = false,
): HTMLLIElement {
  const li = document.createElement("li");
  const isYou = Boolean(currentUsername && currentUsername === entry.username);
  li.className = isYou ? "leaderboard-entry you" : "leaderboard-entry";

  const rank = document.createElement("span");
  rank.className = "leaderboard-rank";
  rank.textContent = String(entry.rank);

  const name = document.createElement("span");
  name.className = "leaderboard-username";
  name.textContent = `u/${entry.username}${labelAsYou ? " (you)" : ""}`;

  const score = document.createElement("span");
  score.className = "leaderboard-score";
  score.textContent = String(entry.strokes);

  li.append(rank, name, score);
  return li;
}

export async function loadLeaderboard() {
  try {
    const lb: LeaderboardResponse = await apiClient.leaderboard();
    const list = el("leaderboard-list");
    list.replaceChildren();
    if (lb.entries.length === 0) {
      const li = document.createElement("li");
      li.className = "lb-empty";
      li.textContent = "Be the first to finish today!";
      list.appendChild(li);
    }
    for (const e of lb.entries) {
      list.appendChild(createLeaderboardRow(e, lb.you?.username ?? null));
    }
    el("lb-total").textContent = `${lb.totalPlayers} players today`;
    if (lb.you && !lb.entries.some((e) => e.username === lb.you!.username)) {
      list.appendChild(createLeaderboardRow(lb.you, lb.you.username, true));
    }
  } catch (err) {
    console.error("leaderboard load failed", err);
  }
}

export function openLeaderboard() {
  show("leaderboard-overlay");
  void loadLeaderboard();
}
