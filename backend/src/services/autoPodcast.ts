import { db, type VideoRow } from "../db/index.js";
import { downloadAudioFile } from "./ytdlp.js";

/** Finds podcast-flagged videos that don't have audio extracted yet and extracts them. */
export async function runAutoPodcastExtraction(): Promise<{ processed: number; failed: number }> {
  const pending = db
    .prepare(
      `SELECT * FROM videos
       WHERE is_podcast = 1
         AND removed_from_source = 0
         AND audio_download_status = 'none'`
    )
    .all() as VideoRow[];

  let processed = 0;
  let failed = 0;
  for (const video of pending) {
    try {
      await downloadAudioFile(video.video_id);
      processed++;
    } catch {
      failed++;
    }
  }
  return { processed, failed };
}
