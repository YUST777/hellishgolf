import { reddit } from '@devvit/web/server';
import { getDailyInfo, setPostMap } from './daily';

/**
 * Create a new Peak Putt post. If a `seed` is provided (user-generated hole),
 * the post is pinned to that seed; otherwise it snapshots today's daily hole.
 */
export async function createPost(opts?: { mapId?: number; title?: string }) {
  const daily = getDailyInfo();
  const mapId = opts?.mapId ?? daily.mapId;
  const title =
    opts?.title ?? `Peak Putt \u2014 Hole #${daily.holeNumber} (${daily.dateKey})`;

  const post = await reddit.submitCustomPost({ title });

  await setPostMap(post.id, mapId);
  return post;
}
