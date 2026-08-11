import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readDb, writeDb, videosArray, updateVideo, type VideoRecord } from "../lib/db.js";
import { classifyPodcast } from "../lib/podcastDetector.js";
import { listPlaylist } from "../lib/ytdlp.js";
import { kickoffDownloadJob } from "../lib/sandboxJobs.js";
import { hasCronSecret } from "../lib/auth.js";
import { WATCH_LATER_PLAYLIST_ID } from "../lib/env.js";

// Kick off at most this many podcast-audio extraction jobs per sync run, so
// one sync doesn't try to spin up a dozen Sandboxes at once. Anything left
// over gets picked up on the next scheduled sync (every ~15 min).
const MAX_EXTRACTIONS_PER_SYNC = 3;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  // POST is what the scheduled Routine calls and requires the cron secret.
  // GET is left open for the frontend's "Sync now" button — it only reads
  // the (unlisted, already-private) playlist and re-derives state, so
  // there's nothing destructive an unauthenticated caller could do with it.
  if (req.method === "POST" && !hasCronSecret(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const items = await listPlaylist(WATCH_LATER_PLAYLIST_ID);
    const db = await readDb();
    const currentIds = new Set(items.map((i) => i.videoId));
    let added = 0;

    for (const item of items) {
      const existing = db.videos[item.videoId];
      const classification = classifyPodcast({
        title: item.title,
        description: existing?.description ?? "",
        channelTitle: item.channelTitle,
        durationSeconds: item.durationSeconds,
      });

      if (!existing) {
        added++;
        const record: VideoRecord = {
          video_id: item.videoId,
          title: item.title,
          channel_title: item.channelTitle || null,
          description: null,
          duration_seconds: item.durationSeconds,
          thumbnail_url: item.thumbnailUrl,
          published_at: null,
          added_at: new Date().toISOString(),
          is_podcast: classification.isPodcast ? 1 : 0,
          podcast_reason: classification.reason,
          video_download_status: "none",
          video_file_path: null,
          video_file_bytes: null,
          audio_download_status: "none",
          audio_file_path: null,
          audio_file_bytes: null,
          watched: 0,
          removed_from_source: 0,
        };
        db.videos[item.videoId] = record;
      } else {
        db.videos[item.videoId] = {
          ...existing,
          title: item.title,
          channel_title: item.channelTitle || existing.channel_title,
          duration_seconds: item.durationSeconds,
          thumbnail_url: item.thumbnailUrl,
          removed_from_source: 0,
        };
      }
    }

    // Mark videos no longer in the source playlist (removed/cleared by Chris).
    for (const id of Object.keys(db.videos)) {
      if (!currentIds.has(id) && db.videos[id].removed_from_source === 0) {
        db.videos[id] = { ...db.videos[id], removed_from_source: 1 };
      }
    }

    await writeDb(db);

    // Best-effort: kick off podcast audio auto-extraction for a batch of
    // still-pending podcast-flagged videos.
    const host = req.headers.host as string | undefined;
    const pending = videosArray(db).filter(
      (v) => v.is_podcast === 1 && v.removed_from_source === 0 && v.audio_download_status === "none"
    );
    let extractionsKicked = 0;
    for (const v of pending.slice(0, MAX_EXTRACTIONS_PER_SYNC)) {
      try {
        await updateVideo(v.video_id, { audio_download_status: "downloading" });
        await kickoffDownloadJob(v.video_id, "audio", host);
        extractionsKicked++;
      } catch (err) {
        console.error("[sync] failed to kick off audio extraction for", v.video_id, err);
        await updateVideo(v.video_id, { audio_download_status: "failed" }).catch(() => {});
      }
    }

    res.status(200).json({
      added,
      total: items.length,
      podcastExtractionsQueued: extractionsKicked,
      podcastExtractionsPending: pending.length - extractionsKicked,
    });
  } catch (err: any) {
    console.error("[sync] failed:", err);
    res.status(502).json({ error: err?.message || String(err) });
  }
}
