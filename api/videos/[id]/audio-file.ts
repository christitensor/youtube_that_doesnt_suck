// The Blob store is private, so a finished mp3 has no public URL. Instead
// of streaming the bytes through this Function (size/duration limits, and no
// HTTP Range support, which iOS needs to play video), redirect to a
// short-lived presigned Blob URL and let Blob's CDN serve it.
// Also the RSS enclosure URL for the podcast feed (podcast apps follow the
// redirect), so it must work with no auth/cookies.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readDb } from "../../../lib/db.js";
import { presignedReadUrl } from "../../../lib/blobUrls.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id;
  if (typeof id !== "string") {
    res.status(400).json({ error: "missing video id" });
    return;
  }

  const db = await readDb();
  const path = db.videos[id]?.audio_file_path;
  if (!path) {
    res.status(404).json({ error: "not extracted yet" });
    return;
  }

  try {
    const url = await presignedReadUrl(path);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, url);
  } catch (err: any) {
    console.error("[audio-file] failed to presign", path, err);
    res.status(502).json({ error: err?.message || String(err) });
  }
}
