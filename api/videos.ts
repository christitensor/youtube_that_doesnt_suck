import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readDb, videosArray } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const db = await readDb();
  const videos = videosArray(db).filter((v) => v.removed_from_source === 0);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(videos);
}
