import { Router } from "express";
import fs from "node:fs";
import { db, type VideoRow } from "../db/index.js";
import { syncWatchLaterPlaylist } from "../services/youtube.js";
import { downloadAudioFile, downloadVideoFile, getDirectStreamUrl } from "../services/ytdlp.js";

export const apiRouter = Router();

apiRouter.get("/videos", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM videos WHERE removed_from_source = 0 ORDER BY added_at DESC")
    .all() as VideoRow[];
  res.json(rows);
});

apiRouter.post("/sync", async (_req, res) => {
  try {
    const result = await syncWatchLaterPlaylist();
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

apiRouter.get("/videos/:id/stream-url", async (req, res) => {
  try {
    const url = await getDirectStreamUrl(req.params.id);
    res.json({ url });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

apiRouter.post("/videos/:id/download", async (req, res) => {
  try {
    const result = await downloadVideoFile(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

apiRouter.post("/videos/:id/download-audio", async (req, res) => {
  try {
    const result = await downloadAudioFile(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

apiRouter.post("/download-all", async (_req, res) => {
  const rows = db
    .prepare("SELECT video_id FROM videos WHERE removed_from_source = 0 AND video_download_status != 'ready'")
    .all() as { video_id: string }[];

  res.json({ queued: rows.length });

  // Fire-and-forget sequential downloads so we don't hammer YouTube or disk I/O.
  (async () => {
    for (const row of rows) {
      try {
        await downloadVideoFile(row.video_id);
      } catch {
        // status already marked 'failed' inside downloadVideoFile
      }
    }
  })();
});

apiRouter.get("/videos/:id/video-file", (req, res) => {
  const row = db.prepare("SELECT * FROM videos WHERE video_id = ?").get(req.params.id) as VideoRow | undefined;
  if (!row?.video_file_path || !fs.existsSync(row.video_file_path)) {
    res.status(404).json({ error: "File not downloaded yet" });
    return;
  }
  res.download(row.video_file_path, `${row.title}.mp4`);
});

apiRouter.get("/videos/:id/audio-file", (req, res) => {
  const row = db.prepare("SELECT * FROM videos WHERE video_id = ?").get(req.params.id) as VideoRow | undefined;
  if (!row?.audio_file_path || !fs.existsSync(row.audio_file_path)) {
    res.status(404).json({ error: "File not extracted yet" });
    return;
  }
  res.download(row.audio_file_path, `${row.title}.mp3`);
});

apiRouter.post("/videos/:id/watched", (req, res) => {
  db.prepare("UPDATE videos SET watched = 1 WHERE video_id = ?").run(req.params.id);
  res.json({ ok: true });
});
