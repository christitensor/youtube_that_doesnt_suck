import path from "node:path";
import fs from "node:fs";
import YTDlpWrap from "yt-dlp-wrap";
import { env } from "../env.js";
import { db } from "../db/index.js";

const ytDlpWrap = new YTDlpWrap.default();

function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Resolves a direct, ad-free media URL for in-app streaming (not saved to disk). */
export async function getDirectStreamUrl(videoId: string): Promise<string> {
  const output = await ytDlpWrap.execPromise([
    videoUrl(videoId),
    "-f", "best[ext=mp4]/best",
    "--get-url",
  ]);
  const url = output.trim().split("\n").at(-1);
  if (!url) throw new Error(`yt-dlp returned no stream URL for ${videoId}`);
  return url;
}

export async function downloadVideoFile(videoId: string): Promise<{ filePath: string; bytes: number }> {
  const dir = path.join(env.MEDIA_DIR, "video");
  fs.mkdirSync(dir, { recursive: true });
  const outputTemplate = path.join(dir, `${videoId}.%(ext)s`);

  db.prepare("UPDATE videos SET video_download_status = 'downloading' WHERE video_id = ?").run(videoId);
  try {
    await ytDlpWrap.execPromise([
      videoUrl(videoId),
      "-f", "best[ext=mp4]/best",
      "-o", outputTemplate,
      "--no-playlist",
    ]);
    const filePath = path.join(dir, `${videoId}.mp4`);
    const bytes = fs.statSync(filePath).size;
    db.prepare(
      "UPDATE videos SET video_download_status = 'ready', video_file_path = ?, video_file_bytes = ? WHERE video_id = ?"
    ).run(filePath, bytes, videoId);
    return { filePath, bytes };
  } catch (err) {
    db.prepare("UPDATE videos SET video_download_status = 'failed' WHERE video_id = ?").run(videoId);
    throw err;
  }
}

export async function downloadAudioFile(videoId: string): Promise<{ filePath: string; bytes: number }> {
  const dir = path.join(env.MEDIA_DIR, "audio");
  fs.mkdirSync(dir, { recursive: true });
  const outputTemplate = path.join(dir, `${videoId}.%(ext)s`);

  db.prepare("UPDATE videos SET audio_download_status = 'downloading' WHERE video_id = ?").run(videoId);
  try {
    await ytDlpWrap.execPromise([
      videoUrl(videoId),
      "-x", "--audio-format", "mp3", "--audio-quality", "2",
      "-o", outputTemplate,
      "--no-playlist",
    ]);
    const filePath = path.join(dir, `${videoId}.mp3`);
    const bytes = fs.statSync(filePath).size;
    db.prepare(
      "UPDATE videos SET audio_download_status = 'ready', audio_file_path = ?, audio_file_bytes = ? WHERE video_id = ?"
    ).run(filePath, bytes, videoId);
    return { filePath, bytes };
  } catch (err) {
    db.prepare("UPDATE videos SET audio_download_status = 'failed' WHERE video_id = ?").run(videoId);
    throw err;
  }
}
