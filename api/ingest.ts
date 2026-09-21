// Callback endpoint for Sandbox jobs. The Sandbox uploads the finished file
// straight to Vercel Blob itself (a Function can't receive it: request
// bodies are capped at ~4.5 MB), then POSTs here with no body:
//   X-Status: uploaded  -> we verify the blob exists and mark the video ready
//   X-Status: failed    -> mark it failed, keeping the log tail as last_error
// so a failed job never leaves a video stuck on "downloading" forever.
// Also doubles as the cookies-upload endpoint (X-Kind: cookies) so the
// Settings page can push a fresh cookies.txt without a dedicated function
// (we're at the Hobby plan's 12-function cap).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import getRawBody from "raw-body";
import { readDb, updateVideo } from "../lib/db.js";
import { privateBlobSize } from "../lib/blobUrls.js";
import { hasCronSecret } from "../lib/auth.js";
import { writeCookiesText } from "../lib/cookies.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (!hasCronSecret(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const kind = req.headers["x-kind"];

  if (kind === "cookies") {
    let cookiesBody: Buffer;
    try {
      cookiesBody = await getRawBody(req, { limit: "1mb" });
    } catch (err: any) {
      res.status(400).json({ error: `failed to read body: ${err?.message || err}` });
      return;
    }
    const text = cookiesBody.toString("utf8");
    if (!text.trim()) {
      res.status(400).json({ error: "empty cookies body" });
      return;
    }
    await writeCookiesText(text);
    res.status(200).json({ ok: true, saved: "cookies" });
    return;
  }

  const videoId = req.headers["x-video-id"];
  const status = req.headers["x-status"];

  if (typeof videoId !== "string" || (kind !== "video" && kind !== "audio")) {
    res.status(400).json({ error: "missing/invalid X-Video-Id or X-Kind header" });
    return;
  }

  const db = await readDb();
  if (!db.videos[videoId]) {
    res.status(404).json({ error: "unknown video" });
    return;
  }

  if (status === "failed") {
    const b64 = req.headers["x-error-b64"];
    const detail =
      typeof b64 === "string" && b64
        ? Buffer.from(b64, "base64").toString("utf8").slice(-1000)
        : "sandbox job failed (no log received)";
    console.error(`[ingest] ${kind} job failed for ${videoId}:\n${detail}`);
    await updateVideo(
      videoId,
      kind === "video"
        ? { video_download_status: "failed", last_error: detail }
        : { audio_download_status: "failed", last_error: detail }
    );
    res.status(200).json({ ok: true, marked: "failed" });
    return;
  }

  if (status !== "uploaded") {
    res.status(400).json({ error: "expected X-Status: uploaded or failed" });
    return;
  }

  // Only accept the path this job is supposed to have written, and confirm
  // the blob is really there rather than trusting the caller's word for it.
  const pathname = req.headers["x-pathname"];
  const expectedPrefix = `media/${kind}/${videoId}.`;
  if (typeof pathname !== "string" || !pathname.startsWith(expectedPrefix) || pathname.includes("/", expectedPrefix.length)) {
    res.status(400).json({ error: "missing/invalid X-Pathname header" });
    return;
  }
  const bytes = await privateBlobSize(pathname);
  if (!bytes) {
    const detail = `ingest: uploaded blob ${pathname} not found or empty`;
    console.error(`[ingest] ${detail}`);
    await updateVideo(
      videoId,
      kind === "video"
        ? { video_download_status: "failed", last_error: detail }
        : { audio_download_status: "failed", last_error: detail }
    );
    res.status(400).json({ error: detail });
    return;
  }

  await updateVideo(
    videoId,
    kind === "video"
      ? { video_download_status: "ready", video_file_path: pathname, video_file_bytes: bytes, last_error: null }
      : { audio_download_status: "ready", audio_file_path: pathname, audio_file_bytes: bytes, last_error: null }
  );

  res.status(200).json({ ok: true, pathname, bytes });
}
