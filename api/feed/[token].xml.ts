import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildPodcastFeedXml } from "../../lib/feed.js";
import { FEED_TOKEN } from "../../lib/env.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.query.token;
  if (token !== FEED_TOKEN) {
    res.status(404).send("Not found");
    return;
  }
  const xml = await buildPodcastFeedXml(req.headers.host as string | undefined);
  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.status(200).send(xml);
}
