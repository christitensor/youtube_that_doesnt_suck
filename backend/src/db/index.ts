import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env.js";

fs.mkdirSync(path.dirname(env.DB_PATH), { recursive: true });
fs.mkdirSync(env.MEDIA_DIR, { recursive: true });

export const db = new Database(env.DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel_title TEXT,
  description TEXT,
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  published_at TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),

  is_podcast INTEGER NOT NULL DEFAULT 0,
  podcast_reason TEXT,

  video_download_status TEXT NOT NULL DEFAULT 'none',
  video_file_path TEXT,
  video_file_bytes INTEGER,

  audio_download_status TEXT NOT NULL DEFAULT 'none',
  audio_file_path TEXT,
  audio_file_bytes INTEGER,

  watched INTEGER NOT NULL DEFAULT 0,
  removed_from_source INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_videos_added_at ON videos(added_at);
CREATE INDEX IF NOT EXISTS idx_videos_is_podcast ON videos(is_podcast);
`);

export type VideoRow = {
  video_id: string;
  title: string;
  channel_title: string | null;
  description: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  published_at: string | null;
  added_at: string;

  is_podcast: 0 | 1;
  podcast_reason: string | null;

  video_download_status: "none" | "downloading" | "ready" | "failed";
  video_file_path: string | null;
  video_file_bytes: number | null;

  audio_download_status: "none" | "downloading" | "ready" | "failed";
  audio_file_path: string | null;
  audio_file_bytes: number | null;

  watched: 0 | 1;
  removed_from_source: 0 | 1;
};
