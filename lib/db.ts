// Single-user "database": the whole video queue lives as one JSON blob in
// Vercel Blob storage. Read-modify-write, no separate DB service needed.
import { put, list } from "@vercel/blob";

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
  video_file_url: string | null;
  video_file_bytes: number | null;

  audio_download_status: DownloadStatus;
  audio_file_url: string | null;
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
    const { blobs } = await list({ prefix: DB_PATHNAME, limit: 10 });
    const found = blobs.find((b) => b.pathname === DB_PATHNAME);
    if (!found) return emptyDb();
    const res = await fetch(found.url, { cache: "no-store" });
    if (!res.ok) return emptyDb();
    const data = (await res.json()) as unknown;
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
    access: "public",
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
