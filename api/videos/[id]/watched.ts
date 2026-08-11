// Doubles as the general playback-progress endpoint: the frontend posts
// resume position periodically while playing, and marks completed when a
// video finishes - completed videos drop out of the /api/videos list.
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

  const body = (req.body ?? {}) as { resumeSeconds?: number; completed?: boolean };
  const patch: { watched?: 0 | 1; resume_seconds?: number } = {};

  if (typeof body.resumeSeconds === "number" && Number.isFinite(body.resumeSeconds)) {
    patch.resume_seconds = Math.max(0, Math.floor(body.resumeSeconds));
  }
  if (body.completed === true) {
    patch.watched = 1;
  }

  await updateVideo(id, patch);
  res.status(200).json({ ok: true });
}
