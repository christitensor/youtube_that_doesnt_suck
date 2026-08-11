import type { VercelRequest } from "@vercel/node";
import { CRON_SECRET } from "./env.js";

/** True if the request carries the shared cron secret, either as a Bearer
 * token (used by the scheduled Routine and Sandbox jobs calling back into
 * /api/ingest) or an `?secret=` query param (handy for quick manual curl). */
export function hasCronSecret(req: VercelRequest): boolean {
  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const querySecret = typeof req.query.secret === "string" ? req.query.secret : null;
  return bearer === CRON_SECRET || querySecret === CRON_SECRET;
}
