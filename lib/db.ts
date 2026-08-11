// Single-user "database": the whole video queue lives as one JSON blob in
// Vercel Blob storage. Read-modify-write, no separate DB service needed.
import { put, get } from "@vercel/blob";

const DB_PATHNAME = "db/videos.json";

export type DownloadStatus = "none" | "downloading" | "ready" | "failed";

export type VideoRecord = {
  video_id: string;
  title: string;
  channel_title: string | null;
  description: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  published_at: string | null;
  added_at: string;

  is_podcast: 0 | 1;
  podcast_reason: string | null;

  video_download_status: DownloadStatus;
  video_file_path: string | null;
  video_file_bytes: number | null;

  audio_download_status: DownloadStatus;
  audio_file_path: string | null;
  audio_file_bytes: number | null;

  watched: 0 | 1;
  removed_from_source: 0 | 1;
};

export type Db = {
  videos: Record<string, VideoRecord>;
};

function emptyDb(): Db {
  return { videos: {} };
}

export async function readDb(): Promise<Db> {
  try {
    const result = await get(DB_PATHNAME, { access: "private" });
    if (!result || result.statusCode !== 200) return emptyDb();
    const text = await new Response(result.stream).text();
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== "object" || !("videos" in (data as any))) {
      return emptyDb();
    }
    return data as Db;
  } catch (err) {
    console.error("[db] readDb failed:", err);
    return emptyDb();
  }
}

export async function writeDb(db: Db): Promise<void> {
  await put(DB_PATHNAME, JSON.stringify(db), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export function videosArray(db: Db): VideoRecord[] {
  return Object.values(db.videos).sort((a, b) => (a.added_at < b.added_at ? 1 : -1));
}

/** Convenience: load db, mutate one video record, save. Not race-safe under
 * heavy concurrency, but fine for a single-user app hit by at most a cron
 * tick + one phone. */
export async function updateVideo(
  videoId: string,
  patch: Partial<VideoRecord>
): Promise<void> {
  const db = await readDb();
  const existing = db.videos[videoId];
  if (!existing) return;
  db.videos[videoId] = { ...existing, ...patch };
  await writeDb(db);
}
