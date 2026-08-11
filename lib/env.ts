// Config for the deployed app. Everything has a baked-in default so the app
// works out of the box on a fresh Vercel deploy with zero dashboard clicks —
// this is a private single-user tool, so shipping these as source defaults
// (overridable by real Vercel env vars later, if ever set) is an accepted
// tradeoff, not an oversight.

/** Chris's unlisted "Watch Later Queue" playlist, created via the Zapier
 * YouTube connector. Keep adding videos to it from the YouTube app. */
export const WATCH_LATER_PLAYLIST_ID =
  process.env.WATCH_LATER_PLAYLIST_ID || "PLQZGy6-2-yEU";

/** Bearer secret the scheduled sync Routine must present to POST /api/sync
 * and /api/download-all, and that Sandbox jobs present when calling back
 * into /api/ingest. */
export const CRON_SECRET =
  process.env.CRON_SECRET || "6da3c30f9e9208ca33c3bd5cef3fa947d82fa901ad53b94f";

/** Acts as the password for the podcast RSS feed URL — keep it out of
 * anything public. */
export const FEED_TOKEN =
  process.env.FEED_TOKEN || "b4708dad60af4a30bb0259533affb021b0dee4e43d081c07";

/** Base URL of this deployment, used to build absolute URLs in the RSS feed.
 * VERCEL_URL is set automatically at runtime; VERCEL_PROJECT_PRODUCTION_URL
 * is preferred so preview deploys still link back to production where
 * possible once known. Falls back to localhost for local dev. */
export function publicBaseUrl(reqHost?: string): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (reqHost) return `https://${reqHost}`;
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return "http://localhost:3000";
}
