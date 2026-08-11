// Same as video-file.ts but for the extracted mp3 - also used as the RSS
// enclosure URL for the podcast feed, so it must work with no auth/cookies.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { get } from "@vercel/blob";
import { readDb } from "../../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id;
  if (typeof id !== "string") {
    res.status(400).json({ error: "missing video id" });
    return;
  }

  const db = await readDb();
  const video = db.videos[id];
  if (!video?.audio_file_path) {
    res.status(404).json({ error: "not extracted yet" });
    return;
  }

  const result = await get(video.audio_file_path, { access: "private" });
  if (!result || result.statusCode !== 200) {
    res.status(404).json({ error: "file not found in storage" });
    return;
  }

  res.setHeader("Content-Type", result.blob.contentType || "audio/mpeg");
  res.setHeader("Content-Disposition", `attachment; filename="${video.title.replace(/"/g, "")}.mp3"`);
  const buf = Buffer.from(await new Response(result.stream).arrayBuffer());
  res.status(200).send(buf);
}
