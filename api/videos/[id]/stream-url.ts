import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDirectStreamUrl } from "../../../lib/ytdlp.js";
import { readDb, updateVideo } from "../../../lib/db.js";
import { kickoffDownloadJob } from "../../../lib/sandboxJobs.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id;
  if (typeof id !== "string") {
    res.status(400).json({ error: "missing video id" });
    return;
  }
  try {
    const db = await readDb();
    const video = db.videos[id];

    // A full-quality copy may already have been rendered in the background
    // (by sync's proactive prepare below, or by a previous play of this
    // video) - serve that directly from Blob storage instead of resolving a
    // fresh direct URL, which is capped at 360p (progressive/muxed formats
    // top out there on every client, a real YouTube-side limit). This is
    // also strictly faster: no yt-dlp shellout at all, just a blob stream.
    if (video?.video_download_status === "ready" && video.video_file_path) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ url: `/api/videos/${id}/video-file` });
      return;
    }

    // Not rendered yet - play instantly at the 360p ceiling, and kick off a
    // background render (unless one's already in flight) so the *next*
    // play of this video is full quality and instant too.
    const url = await getDirectStreamUrl(id);
    if (video && video.video_download_status === "none") {
      await updateVideo(id, { video_download_status: "downloading" });
      kickoffDownloadJob(id, "video", req.headers.host as string | undefined).catch((err) => {
        console.error("[stream-url] background render failed to start for", id, err);
        updateVideo(id, { video_download_status: "failed" }).catch(() => {});
      });
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ url });
  } catch (err: any) {
    console.error("[stream-url] failed for", id, err);
    res.status(502).json({ error: err?.message || String(err) });
  }
}
