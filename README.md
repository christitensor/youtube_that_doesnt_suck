# Watch Later

A personal, ad-free YouTube watch-later app for iPhone/iPad, with one-tap bulk
downloads and automatic podcast (mp3) extraction for long-form videos. Runs
as a single Vercel deployment — no separate backend to host, no database to
provision, no YouTube API key.

**This is a personal-use tool.** It uses [yt-dlp](https://github.com/yt-dlp/yt-dlp)
to pull direct media streams, which is how it plays without ads and enables
downloads — this goes beyond what YouTube's Terms of Service permit for
third-party apps, and it can't be distributed publicly or shipped to an App
Store. Keep your deployment private (the podcast feed token and the
`/api/ingest` endpoint act as access keys — don't share the deployment URL
around).

## How it works

- **Watch Later queue**: YouTube's real "Watch Later" list isn't accessible
  via any API, so this app syncs from a normal (unlisted) playlist instead —
  "Watch Later Queue" (`PLQZGy6-2-yEU`) — that videos get added to from the
  YouTube app or a Zapier connector, just like Watch Later normally works.
- **`/api/*` (Vercel Functions)**: sync the playlist via `yt-dlp
  --flat-playlist` (no API key, no auth — it just scrapes the public
  unlisted playlist page), resolve ad-free direct stream URLs for in-app
  playback, auto-detect podcast-like videos (long-form + title/channel
  signals) and kick off audio extraction, and serve a private podcast RSS
  feed. The whole video queue is one JSON file in Vercel Blob — no separate
  database.
- **Vercel Sandbox**: full video downloads and mp3 audio extraction run in a
  Sandbox microVM (yt-dlp + ffmpeg), since those can take longer than a
  normal Function allows. The Sandbox uploads the finished file to Vercel
  Blob and calls back into `/api/ingest` to mark it ready.
- **`/frontend`**: an installable PWA (Add to Home Screen on iPhone/iPad)
  that lists the queue, plays videos ad-free, and has buttons for "Download
  all to device" and per-video downloads. Talks to `/api/...` on the same
  origin — no backend URL to configure.
- **Scheduled sync**: since Vercel Hobby cron is once-a-day and tied to a
  Function's short duration anyway, the periodic sync is triggered from
  outside Vercel — a Claude Code Remote Routine curls `POST /api/sync` on a
  schedule with a bearer secret.

## Project layout

```
api/       Vercel Functions (sync, videos, stream-url, download, ingest, feed)
lib/       Shared server-side code (blob "db", podcast heuristic, yt-dlp wrapper, feed builder)
frontend/  React + Vite PWA
```

## Configuration

Everything ships with working defaults baked into `lib/env.ts` (playlist ID,
feed token, cron secret) since this is a single-user private tool — nothing
to fill in for a fresh deploy. Real Vercel project environment variables
(`WATCH_LATER_PLAYLIST_ID`, `FEED_TOKEN`, `CRON_SECRET`) override those
defaults if you ever set them.

The one piece that **must** be provisioned manually (Vercel doesn't expose
an API/CLI-token-free way to do this): a **Vercel Blob store**, connected to
the project, so `BLOB_READ_WRITE_TOKEN` is available to the Functions. In
the Vercel dashboard: **Storage → Create Database → Blob → Connect to
project**, then redeploy.

## Day-to-day use

- Add videos to the "Watch Later Queue" playlist from the YouTube app (or
  the Zapier connector), as usual.
- Open the app → **Sync now** (or wait for the scheduled Routine) to pull
  new videos in.
- Tap **▶ Play** to watch ad-free without downloading, or **Download** to
  save it for offline, or **Download all to device** to grab everything in
  the queue at once (kicks off Sandbox jobs, polls status).
- Long-form videos get flagged 🎙 and their audio is extracted automatically
  and shows up in your podcast app via the feed URL in Settings.
