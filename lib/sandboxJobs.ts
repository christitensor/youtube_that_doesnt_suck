// Kicks off long-running yt-dlp/ffmpeg jobs (full video download, mp3 audio
// extraction) in a Vercel Sandbox microVM, which can run far longer than a
// plain Vercel Function and isn't tied to the invoking request's lifetime.
// The sandbox does the work and calls back into /api/ingest with the
// resulting file; we never block a Function on the download itself.
import { Sandbox } from "@vercel/sandbox";
import { CRON_SECRET, publicBaseUrl } from "./env.js";
import { readCookiesText } from "./cookies.js";

export type JobKind = "video" | "audio";

const SANDBOX_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes, plenty for one video

function buildScript(kind: JobKind, videoId: string, ingestUrl: string, cookiesText: string | null): string {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Cookies from a real signed-in browser session (uploaded via Settings)
  // are what gets past YouTube's bot-check. Pinning to the "tv" client
  // (confirmed fastest and most reliable via direct timing tests) instead
  // of yt-dlp's slower default multi-client fallback.
  // YouTube gates most real formats behind an obfuscated "n" signature
  // challenge that yt-dlp needs a JS runtime to solve - without one,
  // requests silently degrade to storyboard-only or SABR-gated formats
  // with no usable URL, regardless of cookies (confirmed by direct local
  // testing against a real video: zero playable formats without a JS
  // runtime, a working muxed mp4 with one).
  const cookiesArg = cookiesText ? `--cookies /tmp/cookies.txt` : "";
  const jsRuntimeArg = `$JS_RUNTIME_ARG`;
  const clientArg = `--extractor-args "youtube:player_client=tv"`;
  const ytdlpArgs =
    kind === "video"
      ? // Combined (muxed) progressive formats top out at 360p (itag 18) -
        // higher resolutions only exist as separate video+audio tracks. We
        // ask for the best of each and let ffmpeg mux them (the Sandbox has
        // time and ffmpeg for this, unlike the instant "Play" stream) -
        // *when YouTube actually hands out a URL for them*. As of this
        // writing YouTube is enforcing "SABR-only" streaming for these
        // split tracks on every client we have working (confirmed via
        // direct testing: bestvideo+bestaudio errors "Requested format is
        // not available" every time, consistently, not intermittently),
        // which strips their direct URLs entirely without a Proof-of-Origin
        // token provider - a persistent headless-browser service beyond
        // what's reasonable to run for this project. So this currently
        // falls through to 360p regardless, same ceiling as Play. Left as
        // bestvideo+bestaudio-first (rather than reverting to a plain
        // best-only selector) so it self-upgrades to real quality without
        // another code change if/when that restriction eases.
        `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best" --merge-output-format mp4 -o "out.%(ext)s" --no-playlist --no-warnings ${clientArg} ${jsRuntimeArg} ${cookiesArg}`
      : `-x --audio-format mp3 --audio-quality 2 -o "out.%(ext)s" --no-playlist --no-warnings ${clientArg} ${jsRuntimeArg} ${cookiesArg}`;

  const cookiesSetup = cookiesText
    ? `cat > /tmp/cookies.txt <<'YTDLP_COOKIES_EOF'\n${cookiesText}\nYTDLP_COOKIES_EOF\nchmod 600 /tmp/cookies.txt\n`
    : "";

  const nodeSetup = `
if ! command -v node >/dev/null 2>&1; then
  apt-get update -y >/tmp/apt.log 2>&1 && apt-get install -y nodejs >>/tmp/apt.log 2>&1
fi
JS_RUNTIME_ARG=""
if command -v node >/dev/null 2>&1; then
  JS_RUNTIME_ARG="--js-runtimes node:$(command -v node)"
fi
`;

  // Needed for both kinds now: audio extraction always required it, and
  // video downloads now merge separate video+audio tracks into one mp4.
  const ffmpegSetup = `
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update -y >/tmp/apt.log 2>&1 && apt-get install -y ffmpeg >>/tmp/apt.log 2>&1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  curl -sL -o /tmp/ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
  tar xf /tmp/ffmpeg.tar.xz -C /tmp
  FFDIR=$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*-amd64-static' | head -1)
  export PATH="$FFDIR:$PATH"
fi
`;

  const fail = `curl -sS -X POST "${ingestUrl}" -H "Authorization: Bearer ${CRON_SECRET}" -H "X-Video-Id: ${videoId}" -H "X-Kind: ${kind}" -H "X-Status: failed" >/tmp/ingest-fail.log 2>&1 || true`;

  return `#!/bin/bash
set -u
cd /tmp
curl -sL -o /tmp/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" || { ${fail}; exit 1; }
chmod +x /tmp/yt-dlp
${cookiesSetup}
${nodeSetup}
${ffmpegSetup}
mkdir -p /tmp/work && cd /tmp/work
/tmp/yt-dlp ${ytdlpArgs} "${ytUrl}"
if [ $? -ne 0 ]; then ${fail}; exit 1; fi
FILE=$(ls out.* 2>/dev/null | head -1)
if [ -z "$FILE" ]; then ${fail}; exit 1; fi
curl -sS -X POST "${ingestUrl}" \\
  -H "Authorization: Bearer ${CRON_SECRET}" \\
  -H "Content-Type: application/octet-stream" \\
  -H "X-Video-Id: ${videoId}" \\
  -H "X-Kind: ${kind}" \\
  -H "X-Filename: $FILE" \\
  --data-binary "@$FILE"
`;
}

/** Fire-and-forget: creates a sandbox, launches the job detached, and
 * returns as soon as it's launched (does not wait for the download). */
export async function kickoffDownloadJob(videoId: string, kind: JobKind, reqHost?: string): Promise<void> {
  const ingestUrl = `${publicBaseUrl(reqHost)}/api/ingest`;
  const cookiesText = await readCookiesText();
  const script = buildScript(kind, videoId, ingestUrl, cookiesText);

  // No `runtime`/`image` specified — uses Vercel's default
  // `vercel/sandbox/universal` image, which has more general-purpose
  // tooling (curl, apt, etc.) preinstalled than the bare Node runtimes.
  const sandbox = await Sandbox.create({
    timeout: SANDBOX_TIMEOUT_MS,
  });

  await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", script],
    sudo: true,
    detached: true,
  });
}
