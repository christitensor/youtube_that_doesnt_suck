import RSS from "rss";
import { readDb, videosArray } from "./db.js";
import { FEED_TOKEN, publicBaseUrl } from "./env.js";

export async function buildPodcastFeedXml(reqHost?: string): Promise<string> {
  const base = publicBaseUrl(reqHost);
  const feed = new RSS({
    title: "Watch Later Podcasts",
    description: "Auto-extracted audio from long-form videos in your YouTube watch-later queue",
    feed_url: `${base}/api/feed/${FEED_TOKEN}.xml`,
    site_url: base,
    pubDate: new Date(),
    ttl: 15,
  });

  const db = await readDb();
  const episodes = videosArray(db).filter(
    (v) => v.is_podcast === 1 && v.audio_download_status === "ready" && v.audio_file_path
  );

  for (const ep of episodes) {
    feed.item({
      title: ep.title,
      description: ep.description ?? "",
      url: `https://www.youtube.com/watch?v=${ep.video_id}`,
      guid: ep.video_id,
      date: ep.published_at ?? ep.added_at,
      enclosure: {
        // The Blob store is private, so proxy through our own Function
        // instead of a direct blob URL - podcast apps just need a stable,
        // unauthenticated URL, which this endpoint provides.
        url: `${base}/api/videos/${ep.video_id}/audio-file`,
        size: ep.audio_file_bytes ?? 0,
        type: "audio/mpeg",
      },
    });
  }

  return feed.xml({ indent: true });
}
