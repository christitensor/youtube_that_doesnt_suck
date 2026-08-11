import { env } from "../env.js";
import { db, type VideoRow } from "../db/index.js";
import { classifyPodcast } from "./podcastDetector.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";

function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return (Number(h ?? 0) * 3600) + (Number(min ?? 0) * 60) + Number(s ?? 0);
}

async function fetchAllPlaylistItems(): Promise<
  { videoId: string; title: string; channelTitle: string; description: string; thumbnailUrl: string; publishedAt: string }[]
> {
  const items: { videoId: string; title: string; channelTitle: string; description: string; thumbnailUrl: string; publishedAt: string }[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${API_BASE}/playlistItems`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", env.WATCH_LATER_PLAYLIST_ID);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", env.YOUTUBE_API_KEY);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`YouTube playlistItems.list failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json() as any;

    for (const item of data.items ?? []) {
      const snippet = item.snippet;
      if (!snippet?.resourceId?.videoId) continue;
      items.push({
        videoId: snippet.resourceId.videoId,
        title: snippet.title,
        channelTitle: snippet.videoOwnerChannelTitle ?? snippet.channelTitle ?? "",
        description: snippet.description ?? "",
        thumbnailUrl: snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? "",
        publishedAt: snippet.publishedAt ?? "",
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return items;
}

async function fetchDurations(videoIds: string[]): Promise<Map<string, number>> {
  const durations = new Map<string, number>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL(`${API_BASE}/videos`);
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", env.YOUTUBE_API_KEY);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`YouTube videos.list failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json() as any;
    for (const item of data.items ?? []) {
      durations.set(item.id, parseIsoDuration(item.contentDetails.duration));
    }
  }
  return durations;
}

export async function syncWatchLaterPlaylist(): Promise<{ added: number; total: number }> {
  const items = await fetchAllPlaylistItems();
  const durations = await fetchDurations(items.map((i) => i.videoId));
  const currentIds = new Set(items.map((i) => i.videoId));

  const existing = new Set(
    (db.prepare("SELECT video_id FROM videos").all() as { video_id: string }[]).map((r) => r.video_id)
  );

  const insert = db.prepare(`
    INSERT INTO videos (video_id, title, channel_title, description, duration_seconds, thumbnail_url, published_at, is_podcast, podcast_reason)
    VALUES (@video_id, @title, @channel_title, @description, @duration_seconds, @thumbnail_url, @published_at, @is_podcast, @podcast_reason)
    ON CONFLICT(video_id) DO UPDATE SET
      title = excluded.title,
      channel_title = excluded.channel_title,
      description = excluded.description,
      duration_seconds = excluded.duration_seconds,
      thumbnail_url = excluded.thumbnail_url,
      removed_from_source = 0
  `);

  let added = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      const durationSeconds = durations.get(item.videoId) ?? 0;
      const classification = classifyPodcast({
        title: item.title,
        description: item.description,
        channelTitle: item.channelTitle,
        durationSeconds,
      });
      if (!existing.has(item.videoId)) added++;
      insert.run({
        video_id: item.videoId,
        title: item.title,
        channel_title: item.channelTitle,
        description: item.description,
        duration_seconds: durationSeconds,
        thumbnail_url: item.thumbnailUrl,
        published_at: item.publishedAt,
        is_podcast: classification.isPodcast ? 1 : 0,
        podcast_reason: classification.reason,
      });
    }

    // Mark videos no longer in the source playlist (removed/watched-and-removed by user)
    const removedStmt = db.prepare("UPDATE videos SET removed_from_source = 1 WHERE video_id = ?");
    const all = db.prepare("SELECT video_id FROM videos WHERE removed_from_source = 0").all() as { video_id: string }[];
    for (const row of all) {
      if (!currentIds.has(row.video_id)) removedStmt.run(row.video_id);
    }
  });
  tx();

  return { added, total: items.length };
}

export function getVideoRow(videoId: string): VideoRow | undefined {
  return db.prepare("SELECT * FROM videos WHERE video_id = ?").get(videoId) as VideoRow | undefined;
}
