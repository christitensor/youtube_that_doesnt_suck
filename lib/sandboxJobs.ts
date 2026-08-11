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
  // Cloud/datacenter IPs (Sandbox included) get YouTube's "confirm you're
  // not a bot" wall on almost every request now - player_client tricks alone
  // don't reliably get through from real Vercel/Sandbox IPs, so cookies from
  // a real signed-in session (uploaded via Settings) are the primary fix,
  // with player_client kept as a harmless secondary hint.
  const cookiesArg = cookiesText ? `--cookies /tmp/cookies.txt` : "";
  const clientArgs = `--extractor-args "youtube:player_client=tv_embedded,mweb" ${cookiesArg}`;
  const ytdlpArgs =
    kind === "video"
      ? `-f "best[ext=mp4]/best" -o "out.%(ext)s" --no-playlist --no-warnings ${clientArgs}`
      : `-x --audio-format mp3 --audio-quality 2 -o "out.%(ext)s" --no-playlist --no-warnings ${clientArgs}`;

  const cookiesSetup = cookiesText
    ? `cat > /tmp/cookies.txt <<'YTDLP_COOKIES_EOF'\n${cookiesText}\nYTDLP_COOKIES_EOF\nchmod 600 /tmp/cookies.txt\n`
    : "";

  const ffmpegSetup =
    kind === "audio"
      ? `
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update -y >/tmp/apt.log 2>&1 && apt-get install -y ffmpeg >>/tmp/apt.log 2>&1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  curl -sL -o /tmp/ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
  tar xf /tmp/ffmpeg.tar.xz -C /tmp
  FFDIR=$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*-amd64-static' | head -1)
  export PATH="$FFDIR:$PATH"
fi
`
      : "";

  const fail = `curl -sS -X POST "${ingestUrl}" -H "Authorization: Bearer ${CRON_SECRET}" -H "X-Video-Id: ${videoId}" -H "X-Kind: ${kind}" -H "X-Status: failed" >/tmp/ingest-fail.log 2>&1 || true`;

  return `#!/bin/bash
set -u
cd /tmp
curl -sL -o /tmp/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" || { ${fail}; exit 1; }
chmod +x /tmp/yt-dlp
${cookiesSetup}
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
