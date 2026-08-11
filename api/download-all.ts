import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readDb, videosArray, updateVideo } from "../lib/db.js";
import { kickoffDownloadJob } from "../lib/sandboxJobs.js";

// Cap how many Sandboxes a single "Download all" tap spins up at once — the
// rest will pick up next time "Download all" (or per-video Download) is
// pressed, since their status stays "none" until actually kicked off.
const MAX_PER_CALL = 8;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const db = await readDb();
  const pending = videosArray(db).filter(
    (v) => v.removed_from_source === 0 && v.video_download_status !== "ready" && v.video_download_status !== "downloading"
  );

  const host = req.headers.host as string | undefined;
  const batch = pending.slice(0, MAX_PER_CALL);
  let queued = 0;
  for (const v of batch) {
    try {
      await updateVideo(v.video_id, { video_download_status: "downloading" });
      await kickoffDownloadJob(v.video_id, "video", host);
      queued++;
    } catch (err) {
      console.error("[download-all] failed to kick off job for", v.video_id, err);
      await updateVideo(v.video_id, { video_download_status: "failed" }).catch(() => {});
    }
  }

  res.status(200).json({ queued, remaining: pending.length - queued });
}
