/**
 * Inline (feed) presentation for the Reddit post.
 *
 * When the web view renders inline in the feed we hide every UI layer and
 * show only the live game view; the first click/tap asks Reddit to expand
 * the post into the full modal experience, where all controls come back.
 *
 * Outside Reddit (Vercel/local preview) the Devvit `devvit` global does not
 * exist, so everything here degrades to a no-op.
 */
// TypeScript resolves this package's server-side "default" export condition
// (which exposes no members), while Vite bundles the "browser" condition that
// does. The namespace import + cast bridges the two.
import * as devvitClient from "@devvit/web/client";

type WebViewMode = "inline" | "expanded";

const { getWebViewMode, requestExpandedMode } =
  devvitClient as unknown as {
    getWebViewMode: () => WebViewMode;
    requestExpandedMode: (event: MouseEvent, entry: string) => void;
  };

const INLINE_CLASS = "inline-view";

function currentMode(): WebViewMode | null {
  try {
    return getWebViewMode();
  } catch {
    return null; // not running inside a Devvit web view
  }
}

function applyMode(mode: WebViewMode | null) {
  document.body.classList.toggle(INLINE_CLASS, mode === "inline");
}

/**
 * Returns true when the post is currently inline in the feed. Call once on
 * boot; wires the expand-on-click overlay and focus-based mode tracking.
 */
export function setupInlineMode(): boolean {
  const mode = currentMode();
  applyMode(mode);
  if (mode !== "inline") return false;

  const overlay = document.getElementById("inline-expand-overlay");
  overlay?.addEventListener("click", (event) => {
    try {
      requestExpandedMode(event, "game");
    } catch {
      // Already expanded (or not in a web view) — just drop the overlay.
      applyMode(currentMode());
    }
  });

  // Reddit re-focuses the web view when presentation changes.
  window.addEventListener("focus", () => applyMode(currentMode()));
  return true;
}
