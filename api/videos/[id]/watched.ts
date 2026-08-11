import type { VercelRequest, VercelResponse } from "@vercel/node";
import { updateVideo } from "../../../lib/db.js";

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
  await updateVideo(id, { watched: 1 });
  res.status(200).json({ ok: true });
}
