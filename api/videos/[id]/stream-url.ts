import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDirectStreamUrl } from "../../../lib/ytdlp.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id;
  if (typeof id !== "string") {
    res.status(400).json({ error: "missing video id" });
    return;
  }
  try {
    const url = await getDirectStreamUrl(id);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ url });
  } catch (err: any) {
    console.error("[stream-url] failed for", id, err);
    res.status(502).json({ error: err?.message || String(err) });
  }
}
