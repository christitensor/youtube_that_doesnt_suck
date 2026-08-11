import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FEED_TOKEN } from "../lib/env.js";

// Lets the frontend build the feed URL as `${window.location.origin}/api/feed/${token}.xml`
// without hardcoding the token at build time.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ token: FEED_TOKEN });
}
