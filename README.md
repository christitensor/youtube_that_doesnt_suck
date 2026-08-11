# Watch Later

A personal, ad-free YouTube watch-later app for iPhone/iPad, with one-tap bulk
downloads and automatic podcast (mp3) extraction for long-form videos.

**This is a personal-use tool.** It uses [yt-dlp](https://github.com/yt-dlp/yt-dlp)
to pull direct media streams, which is how it plays without ads and enables
downloads — this goes beyond what YouTube's Terms of Service permit for
third-party apps, and it can't be distributed publicly or shipped to an App
Store. Keep your deployment private (the podcast feed and backend URL act as
your access keys — don't share them).

## How it works

- **Watch Later queue**: YouTube's real "Watch Later" list isn't accessible
  via their API, so this app syncs from a normal playlist you maintain
  instead (see setup below) — keep adding videos to that playlist from the
  YouTube app like you always have.
- **Backend** (`/backend`): a Node/Express server that syncs the playlist,
  uses yt-dlp to resolve ad-free direct stream URLs for in-app playback,
  downloads full videos on demand, auto-detects podcast-like videos
  (long-form + title/channel signals) and extracts their audio to mp3, and
  serves a private podcast RSS feed.
- **Frontend** (`/frontend`): a installable PWA (Add to Home Screen on
  iPhone/iPad) that lists your queue, plays videos ad-free, and has buttons
  for "Download all to device" and per-video downloads.

## 1. Create your Watch Later playlist

1. In YouTube, create a new playlist (e.g. "My Watch Later"), visibility
   **Unlisted** (Private won't work — the API key can't read private
   playlists without full OAuth).
2. Copy its playlist ID from the URL: `youtube.com/playlist?list=`**`PLxxxxxxxx`**
3. Keep adding videos to it the way you'd normally use Watch Later.

## 2. Get a YouTube Data API key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create a project, enable **YouTube Data API v3**, and create an API key.
2. (Optional but recommended) restrict the key to the YouTube Data API v3.

## 3. Configure the backend

```bash
cd backend
cp .env.example .env
# fill in YOUTUBE_API_KEY, WATCH_LATER_PLAYLIST_ID, FEED_TOKEN (any long
# random string — this is what makes your podcast feed URL private)
npm install
npm run dev
```

The server starts on `http://localhost:8080`. `GET /health` should return `{ok:true}`.

## 4. Deploy the backend so your phone can reach it

Downloads and audio extraction need a real, always-on server with disk space
— your phone can't run yt-dlp/ffmpeg itself. A [Fly.io](https://fly.io) deploy
is included:

```bash
cd backend
fly launch --no-deploy   # creates the app, keep the generated fly.toml settings or merge with the provided one
fly volumes create ytdns_data --size 10   # persistent storage for downloaded media
fly secrets set YOUTUBE_API_KEY=... WATCH_LATER_PLAYLIST_ID=... FEED_TOKEN=... PUBLIC_BASE_URL=https://<your-app>.fly.dev
fly deploy
```

Any other Docker-friendly host with persistent disk (Railway, a home
server/NAS, a Raspberry Pi with Tailscale) works too — just build the
`backend/Dockerfile` and set the same env vars.

## 5. Install the app on iPhone/iPad

```bash
cd frontend
npm install
npm run build   # or `npm run dev` to test locally first
```

Deploy the built `frontend/dist` as a static site (Fly, Vercel static
hosting, GitHub Pages, or even served directly from the backend). Then on
your iPhone/iPad:

1. Open the deployed URL in Safari.
2. Tap the Share icon → **Add to Home Screen**.
3. Open the new "Watch Later" icon — it runs full-screen like a native app.
4. Go to **Settings** in the app and enter your backend URL (e.g.
   `https://your-app.fly.dev`) and the `FEED_TOKEN` you set, then Save.

## 6. Subscribe to the podcast feed

In Settings, copy the podcast feed URL and add it as a custom RSS feed in
Apple Podcasts, Overcast, or any podcast app. Any watch-later video the
backend flags as podcast-like (long-form + podcast/interview signals) gets
its audio extracted automatically and shows up there — no manual downloading.

## Day-to-day use

- Add videos to your "My Watch Later" playlist from the YouTube app, as usual.
- Open the Watch Later app → **Sync now** (or wait — it auto-syncs every
  `SYNC_INTERVAL_MINUTES`, default 15) to pull new videos in.
- Tap **▶ Play** to watch ad-free without downloading, or **Download** to
  save it for offline, or **Download all to device** to grab everything in
  the queue at once.
- Long-form videos get flagged 🎙 and their audio shows up in your podcast
  app automatically once extraction finishes.

## Project layout

```
backend/   Node/TypeScript API server (Express, better-sqlite3, yt-dlp, ffmpeg)
frontend/  React + Vite PWA
```
