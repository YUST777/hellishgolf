import { Hono } from "hono";
import { createPost } from "../core/post";

export const triggers = new Hono();

/**
 * On install, seed the subreddit with a first playable post so moderators and
 * players immediately have something to interact with.
 */
triggers.post("/on-app-install", async (c) => {
  try {
    await createPost();
  } catch (error) {
    console.error(`onAppInstall createPost failed: ${error}`);
  }
  return c.json({ status: "ok" });
});
