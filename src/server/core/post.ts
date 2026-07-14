import { context, reddit } from "@devvit/web/server";
import { getDailyInfo, normalizeMapId, setPostMap } from "./daily";

/**
 * Create a new Hellish Golf post. If a `seed` is provided (user-generated hole),
 * the post is pinned to that seed; otherwise it snapshots today's daily hole.
 */
export async function createPost(opts?: { mapId?: number; title?: string }) {
  const daily = getDailyInfo();
  const mapId = normalizeMapId(opts?.mapId, daily.mapId);
  const title =
    opts?.title ??
    `Hellish Golf \u2014 Hole #${daily.holeNumber} (${daily.dateKey})`;

  const post = await reddit.submitCustomPost({
    title,
    subredditName: context.subredditName,
  });

  await setPostMap(post.id, mapId);
  return post;
}
