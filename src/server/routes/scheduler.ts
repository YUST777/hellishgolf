import { Hono } from "hono";
import { context, reddit } from "@devvit/web/server";
import { getDailyInfo, setPostMap } from "../core/daily";

export const scheduler = new Hono();

/**
 * Runs at ~midnight EST. Creates a fresh post for the day's hole and pins the
 * current daily seed to it so it stays stable even after the calendar rolls.
 * This is the content flywheel: a new post every day keeps the game in feeds.
 */
scheduler.post("/daily-hole", async (c) => {
  try {
    const daily = getDailyInfo();
    const post = await reddit.submitCustomPost({
      title: `Hellish Golf \u2014 Hole #${daily.holeNumber} (${daily.dateKey})`,
      subredditName: context.subredditName,
    });
    await setPostMap(post.id, daily.mapId);
    try {
      await post.sticky();
    } catch {
      // Sticky is best-effort; ignore if it fails.
    }
  } catch (error) {
    console.error(`daily-hole scheduler failed: ${error}`);
  }
  return c.json({ status: "ok" });
});
