import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readDb, videosArray } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const db = await readDb();
  // Finished videos drop out of the queue automatically - "removed" here
  // means "don't show it anymore", not deleted from storage.
  const videos = videosArray(db).filter((v) => v.removed_from_source === 0 && v.watched === 0);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(videos);
}
