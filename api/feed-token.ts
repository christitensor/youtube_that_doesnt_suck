import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FEED_TOKEN, CRON_SECRET } from "../lib/env.js";

// Lets the frontend build the feed URL as `${window.location.origin}/api/feed/${token}.xml`
// without hardcoding the token at build time. Also hands back CRON_SECRET so
// the Settings page can authenticate its cookies upload to /api/ingest
// without a dedicated endpoint (we're at the Hobby plan's 12-function cap).
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ token: FEED_TOKEN, cronSecret: CRON_SECRET });
}
