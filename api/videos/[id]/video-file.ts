// The Blob store is private, so downloaded video files aren't reachable by
// a direct public URL - this streams the blob through the Function instead.
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
  if (!video?.video_file_path) {
    res.status(404).json({ error: "not downloaded yet" });
    return;
  }

  const result = await get(video.video_file_path, { access: "private" });
  if (!result || result.statusCode !== 200) {
    res.status(404).json({ error: "file not found in storage" });
    return;
  }

  res.setHeader("Content-Type", result.blob.contentType || "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="${video.title.replace(/"/g, "")}.mp4"`);
  const buf = Buffer.from(await new Response(result.stream).arrayBuffer());
  res.status(200).send(buf);
}
