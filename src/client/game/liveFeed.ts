/**
 * Live finish feed. Subscribes to the post's realtime channel and shows a
 * toast whenever another player finishes their run — "u/foo finished in 12
 * strokes!" — so the hole feels alive while you're grinding it.
 *
 * Outside Reddit (Vercel/local preview) realtime is unavailable and this
 * degrades to a no-op.
 */
// TypeScript resolves this package's server-side "default" export condition
// (which exposes no members), while Vite bundles the "browser" condition that
// does. The namespace import + cast bridges the two (same as inlineMode.ts).
import * as devvitClient from "@devvit/web/client";
import type { LiveFinishMessage } from "../../shared/types";
import { ctx } from "./state";
import { loadLeaderboard } from "./leaderboard";

const { connectRealtime } = devvitClient as unknown as {
  connectRealtime: <Msg>(opts: {
    channel: string;
    onMessage: (data: Msg) => void;
  }) => unknown;
};

const TOAST_MS = 3500;
const MAX_QUEUE = 4;

let node: HTMLDivElement | null = null;
let hideTimer: number | null = null;
const queue: string[] = [];

function ensureNode(): HTMLDivElement {
  if (node) return node;
  node = document.createElement("div");
  node.id = "live-toast";
  document.body.appendChild(node);
  return node;
}

function showNext() {
  const message = queue.shift();
  if (!message) return;
  const el = ensureNode();
  el.textContent = message;
  el.classList.add("show");
  hideTimer = window.setTimeout(() => {
    el.classList.remove("show");
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      showNext();
    }, 300);
  }, TOAST_MS);
}

function pushLiveToast(message: string) {
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(message);
  if (hideTimer === null) showNext();
}

function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/** Connect to the post's finish channel. Call once after init succeeds. */
export function setupLiveFeed(postId: string) {
  if (!postId || postId === "preview_post" || postId === "offline") return;
  try {
    connectRealtime<LiveFinishMessage>({
      channel: `finish_${postId}`,
      onMessage(msg) {
        if (!msg || msg.type !== "finish") return;
        // Skip our own finishes (all sessions of this account).
        if (ctx.init?.accountId && msg.accountId === ctx.init.accountId) return;
        const strokes = `${msg.strokes} stroke${msg.strokes === 1 ? "" : "s"}`;
        pushLiveToast(
          `\u{1F3CC}\uFE0F u/${msg.username} finished in ${strokes} \u2014 ${ordinal(msg.rank)} today!`,
        );
        void loadLeaderboard();
      },
    });
  } catch {
    // Not running inside a Devvit web view — no live feed.
  }
}
