import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  YOUTUBE_API_KEY: required("YOUTUBE_API_KEY"),
  WATCH_LATER_PLAYLIST_ID: required("WATCH_LATER_PLAYLIST_ID"),
  FEED_TOKEN: required("FEED_TOKEN"),
  MEDIA_DIR: process.env.MEDIA_DIR ?? "./data/media",
  DB_PATH: process.env.DB_PATH ?? "./data/app.db",
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? "http://localhost:8080",
  PORT: Number(process.env.PORT ?? 8080),
  SYNC_INTERVAL_MINUTES: Number(process.env.SYNC_INTERVAL_MINUTES ?? 15),
};
