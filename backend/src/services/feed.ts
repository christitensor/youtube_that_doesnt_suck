import RSS from "rss";
import { db, type VideoRow } from "../db/index.js";
import { env } from "../env.js";

export function buildPodcastFeedXml(): string {
  const feed = new RSS({
    title: "Watch Later Podcasts",
    description: "Auto-extracted audio from long-form videos in your YouTube watch-later queue",
    feed_url: `${env.PUBLIC_BASE_URL}/feed/${env.FEED_TOKEN}.xml`,
    site_url: env.PUBLIC_BASE_URL,
    pubDate: new Date(),
    ttl: env.SYNC_INTERVAL_MINUTES,
  });

  const episodes = db
    .prepare(
      `SELECT * FROM videos
       WHERE is_podcast = 1 AND audio_download_status = 'ready'
       ORDER BY published_at DESC`
    )
    .all() as VideoRow[];

  for (const ep of episodes) {
    feed.item({
      title: ep.title,
      description: ep.description ?? "",
      url: `https://www.youtube.com/watch?v=${ep.video_id}`,
      guid: ep.video_id,
      date: ep.published_at ?? ep.added_at,
      enclosure: {
        url: `${env.PUBLIC_BASE_URL}/api/videos/${ep.video_id}/audio-file`,
        size: ep.audio_file_bytes ?? 0,
        type: "audio/mpeg",
      },
    });
  }

  return feed.xml({ indent: true });
}
