import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readDb, updateVideo } from "../../../lib/db.js";
import { kickoffDownloadJob } from "../../../lib/sandboxJobs.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const id = req.query.id;
  if (typeof id !== "string") {
    res.status(400).json({ error: "missing video id" });
    return;
  }
  const db = await readDb();
  if (!db.videos[id]) {
    res.status(404).json({ error: "unknown video" });
    return;
  }

  await updateVideo(id, { video_download_status: "downloading" });
  try {
    await kickoffDownloadJob(id, "video", req.headers.host as string | undefined);
    res.status(202).json({ status: "queued" });
  } catch (err: any) {
    console.error("[download] failed to kick off job for", id, err);
    await updateVideo(id, { video_download_status: "failed" }).catch(() => {});
    res.status(502).json({ error: err?.message || String(err) });
  }
}
