// Kicks off long-running yt-dlp/ffmpeg jobs (full video download, mp3 audio
// extraction) in a Vercel Sandbox microVM, which can run far longer than a
// plain Vercel Function and isn't tied to the invoking request's lifetime.
// The sandbox does the work and calls back into /api/ingest with the
// resulting file; we never block a Function on the download itself.
import { Sandbox } from "@vercel/sandbox";
import { CRON_SECRET, publicBaseUrl } from "./env.js";
import { readCookiesText } from "./cookies.js";
import { POT_PLUGIN_FILES } from "./potPluginFiles.js";

// Same free, self-hosted PO-token provider as the instant "Play" path (see
// the comment in lib/ytdlp.ts for why cookies alone stopped being enough).
// The sandbox has a full shell and plenty of time, so this just downloads
// the binary and drops the vendored plugin files in via heredocs - no need
// for the Function's /tmp-caching dance since each sandbox is fresh anyway.
const POT_PLUGIN_PKG_DIR = "/tmp/yt-dlp-plugins/bgutil-ytdlp-pot-provider/yt_dlp_plugins/extractor";
const POT_BIN_DOWNLOAD_URL =
  "https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-x86_64";

// The Sandbox uploads the finished file straight to Blob (multipart, from
// inside the microVM) using this token, then tells /api/ingest it's done.
// Posting the file itself to /api/ingest can't work: Vercel Functions reject
// request bodies over ~4.5 MB, and any real video is far bigger.
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? "";

export type JobKind = "video" | "audio";

const SANDBOX_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes, plenty for one video

function buildScript(kind: JobKind, videoId: string, ingestUrl: string, cookiesText: string | null): string {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Cookies from a real signed-in browser session (uploaded via Settings)
  // are what gets past YouTube's bot-check.
  // YouTube gates most real formats behind an obfuscated "n" signature
  // challenge that yt-dlp needs a JS runtime to solve - without one,
  // requests silently degrade to storyboard-only or SABR-gated formats
  // with no usable URL, regardless of cookies (confirmed by direct local
  // testing against a real video: zero playable formats without a JS
  // runtime, a working muxed mp4 with one).
  // Deliberately NOT pinning a single player_client here (unlike the
  // instant "Play" stream path, which pins "tv" for speed): querying
  // yt-dlp's default set of clients together is what makes YouTube hand
  // out URLs for the high-res video-only/audio-only DASH tracks at all.
  // Pinning to one client alone was previously (wrongly) blamed on a
  // YouTube-side "SABR-only" restriction requiring paid proxy/PO-token
  // infra - it was actually this pin suppressing the format list.
  // Confirmed via direct local testing: unpinned resolves up to 4K
  // (315+251-7 3840x2160 vp9+opus) and a full download+merge produces a
  // real, ffprobe-verified 1080p60 h264/aac file, no proxy needed.
  const cookiesArg = cookiesText ? `--cookies /tmp/cookies.txt` : "";
  const jsRuntimeArg = `$JS_RUNTIME_ARG`;
  // Best-effort: if the binary download below fails, this dir still exists
  // (from potPluginSetup) but yt-dlp just reports the provider unavailable
  // and falls back to cookies alone - never fatal.
  const potArg = `--plugin-dirs /tmp/yt-dlp-plugins --extractor-args "youtubepot-bgutilcli:cli_path=/tmp/bgutil-pot"`;
  const ytdlpArgs =
    kind === "video"
      ? // Combined (muxed) progressive formats top out at 360p (itag 18) -
        // higher resolutions only exist as separate video+audio tracks. We
        // ask for the best of each and let ffmpeg mux them (the Sandbox has
        // time and ffmpeg for this, unlike the instant "Play" stream).
        `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best" --merge-output-format mp4 -o "out.%(ext)s" --no-playlist --no-warnings ${jsRuntimeArg} ${cookiesArg} ${potArg}`
      : `-x --audio-format mp3 --audio-quality 2 -o "out.%(ext)s" --no-playlist --no-warnings ${jsRuntimeArg} ${cookiesArg} ${potArg}`;

  const cookiesSetup = cookiesText
    ? `cat > /tmp/cookies.txt <<'YTDLP_COOKIES_EOF'\n${cookiesText}\nYTDLP_COOKIES_EOF\nchmod 600 /tmp/cookies.txt\n`
    : "";

  // Same free PO-token provider as the instant "Play" path (see
  // lib/ytdlp.ts) - vendored plugin source written via heredoc, binary
  // downloaded fresh since each sandbox is a new VM.
  const potPluginSetup =
    `mkdir -p '${POT_PLUGIN_PKG_DIR}'\n` +
    Object.entries(POT_PLUGIN_FILES)
      .map(([name, contents]) => {
        const marker = `POT_PLUGIN_${name.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_EOF`;
        return `cat > '${POT_PLUGIN_PKG_DIR}/${name}' <<'${marker}'\n${contents}\n${marker}\n`;
      })
      .join("") +
    `curl -sSL -o /tmp/bgutil-pot "${POT_BIN_DOWNLOAD_URL}" && chmod +x /tmp/bgutil-pot || echo "warning: bgutil-pot download failed, continuing on cookies alone"\n`;

  // Don't assume which package manager the Sandbox image has (dnf on Amazon
  // Linux, apt-get on Debian/Ubuntu) - try whichever exists. Node is also
  // needed to run the Blob upload below.
  const nodeSetup = `
if ! command -v node >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then dnf install -y nodejs npm
  elif command -v apt-get >/dev/null 2>&1; then apt-get update -y && apt-get install -y nodejs npm
  fi
fi
JS_RUNTIME_ARG=""
if command -v node >/dev/null 2>&1; then
  JS_RUNTIME_ARG="--js-runtimes node:$(command -v node)"
fi
`;

  // Needed for both kinds now: audio extraction always required it, and
  // video downloads now merge separate video+audio tracks into one mp4.
  const ffmpegSetup = `
if ! command -v ffmpeg >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y ffmpeg
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  command -v xz >/dev/null 2>&1 || { command -v dnf >/dev/null 2>&1 && dnf install -y xz; }
  curl -sSL -o /tmp/ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" \\
    && tar xf /tmp/ffmpeg.tar.xz -C /tmp
  FFDIR=$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*-amd64-static' | head -1)
  [ -n "$FFDIR" ] && export PATH="$FFDIR:$PATH"
fi
`;

  const ext = kind === "video" ? "mp4" : "mp3";
  const contentType = kind === "video" ? "video/mp4" : "audio/mpeg";
  const pathname = `media/${kind}/${videoId}.${ext}`;

  // Everything the script prints goes to one log; on failure its tail is
  // sent back to /api/ingest and stored on the video as `last_error`, so a
  // failed job says *why* instead of just "failed".
  const callback = (extraHeaders: string) =>
    `curl -sS -f -X POST "${ingestUrl}" -H "Authorization: Bearer ${CRON_SECRET}" -H "X-Video-Id: ${videoId}" -H "X-Kind: ${kind}" ${extraHeaders}`;
  const fail = `fail() { echo "FAILED: $1"; ${callback('-H "X-Status: failed" -H "X-Error-B64: $(tail -c 900 /tmp/job.log | base64 -w0)"')} >/dev/null 2>&1 || true; exit 1; }`;

  // put() from @vercel/blob does the multipart upload of the (large) file.
  const uploadScript = `
import { put } from "@vercel/blob";
import fs from "node:fs";
const [file, pathname, contentType] = process.argv.slice(2);
const res = await put(pathname, fs.createReadStream(file), {
  access: "private",
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType,
  multipart: true,
});
console.log("uploaded", res.pathname);
`;

  return `#!/bin/bash
exec >/tmp/job.log 2>&1
set -u
${fail}
cd /tmp
curl -sSL -o /tmp/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" || fail "could not download yt-dlp"
chmod +x /tmp/yt-dlp
${cookiesSetup}
${potPluginSetup}
${nodeSetup}
${ffmpegSetup}
command -v node >/dev/null 2>&1 || fail "node is not available in the sandbox"
command -v ffmpeg >/dev/null 2>&1 || fail "ffmpeg is not available in the sandbox"
mkdir -p /tmp/work && cd /tmp/work
/tmp/yt-dlp ${ytdlpArgs} "${ytUrl}" || fail "yt-dlp failed"
FILE=$(ls out.* 2>/dev/null | head -1)
[ -n "$FILE" ] || fail "yt-dlp produced no output file"
BYTES=$(stat -c %s "$FILE")
echo "downloaded $FILE ($BYTES bytes), uploading to blob"

mkdir -p /tmp/up && cd /tmp/up
cat > upload.mjs <<'UPLOAD_EOF'
${uploadScript}
UPLOAD_EOF
npm init -y >/dev/null 2>&1
npm install @vercel/blob@^2.8.0 --no-audit --no-fund || fail "npm install @vercel/blob failed"
export BLOB_READ_WRITE_TOKEN='${BLOB_TOKEN}'
node upload.mjs "/tmp/work/$FILE" "${pathname}" "${contentType}" || fail "blob upload failed"

${callback('-H "X-Status: uploaded" -H "X-Pathname: ' + pathname + '" -H "X-Bytes: $BYTES" -d ""')} || fail "ingest callback failed"
echo done
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
