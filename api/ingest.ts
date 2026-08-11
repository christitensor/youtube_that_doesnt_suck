// Receives the finished file from a Sandbox job (POST with the raw bytes as
// the body, metadata in headers), uploads it to Vercel Blob, and marks the
// video ready in the JSON db. Also accepts an X-Status: failed callback so a
// failed Sandbox job doesn't leave a video stuck on "downloading" forever.
// Also doubles as the cookies-upload endpoint (X-Kind: cookies) so the
// Settings page can push a fresh cookies.txt without a dedicated function
// (we're at the Hobby plan's 12-function cap).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import getRawBody from "raw-body";
import { put } from "@vercel/blob";
import { readDb, updateVideo } from "../lib/db.js";
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
    await updateVideo(
      videoId,
      kind === "video" ? { video_download_status: "failed" } : { audio_download_status: "failed" }
    );
    res.status(200).json({ ok: true, marked: "failed" });
    return;
  }

  let body: Buffer;
  try {
    body = await getRawBody(req, { limit: "2gb" });
  } catch (err: any) {
    res.status(400).json({ error: `failed to read body: ${err?.message || err}` });
    return;
  }

  if (!body.length) {
    await updateVideo(
      videoId,
      kind === "video" ? { video_download_status: "failed" } : { audio_download_status: "failed" }
    );
    res.status(400).json({ error: "empty body" });
    return;
  }

  const filenameHeader = req.headers["x-filename"];
  const filename = typeof filenameHeader === "string" ? filenameHeader : kind === "video" ? "out.mp4" : "out.mp3";
  const ext = filename.includes(".") ? filename.split(".").pop() : kind === "video" ? "mp4" : "mp3";
  const pathname = `media/${kind}/${videoId}.${ext}`;

  await put(pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: kind === "video" ? "video/mp4" : "audio/mpeg",
  });

  await updateVideo(
    videoId,
    kind === "video"
      ? { video_download_status: "ready", video_file_path: pathname, video_file_bytes: body.length }
      : { audio_download_status: "ready", audio_file_path: pathname, audio_file_bytes: body.length }
  );

  res.status(200).json({ ok: true, pathname, bytes: body.length });
}
