// Runs yt-dlp inside a Vercel Node Function. Functions get a writable /tmp
// and outbound network access but no pre-installed binaries, so we fetch the
// self-contained yt-dlp Linux executable into /tmp on cold start and shell
// out to it. No YouTube API key involved anywhere — yt-dlp scrapes the
// public (unlisted) playlist/video pages directly.
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";

const YTDLP_PATH = "/tmp/yt-dlp";
const YTDLP_DOWNLOAD_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

let ensurePromise: Promise<void> | null = null;

async function ensureYtDlp(): Promise<void> {
  if (fs.existsSync(YTDLP_PATH)) return;
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const res = await fetch(YTDLP_DOWNLOAD_URL, { redirect: "follow" });
      if (!res.ok) {
        throw new Error(`Failed to download yt-dlp binary: ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(YTDLP_PATH, buf, { mode: 0o755 });
      await fsp.chmod(YTDLP_PATH, 0o755);
    })();
  }
  await ensurePromise;
}

function run(args: string[], timeoutMs = 40_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`yt-dlp timed out after ${timeoutMs}ms (args: ${args.join(" ")})`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-2000) || stdout.slice(-2000)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runWithRetry(args: string[], timeoutMs?: number, retries = 1): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout } = await run(args, timeoutMs);
      return stdout;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const SEP = "\x1f";

export type FlatPlaylistItem = {
  videoId: string;
  title: string;
  durationSeconds: number;
  channelTitle: string;
  thumbnailUrl: string;
};

/** Lists a (possibly unlisted) playlist's contents with no auth, no API key.
 * Fast — this is a single scrape of the playlist page, not per-video. */
export async function listPlaylist(playlistId: string): Promise<FlatPlaylistItem[]> {
  await ensureYtDlp();
  const stdout = await runWithRetry(
    [
      `https://www.youtube.com/playlist?list=${playlistId}`,
      "--flat-playlist",
      "--no-warnings",
      "--ignore-errors",
      "--print",
      `%(id)s${SEP}%(title)s${SEP}%(duration)s${SEP}%(channel)s${SEP}%(uploader)s`,
    ],
    55_000,
    1
  );

  const items: FlatPlaylistItem[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const [id, title, durationRaw, channel, uploader] = line.split(SEP);
    if (!id) continue;
    const durationSeconds = Number(durationRaw);
    items.push({
      videoId: id,
      title: title || id,
      durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : 0,
      channelTitle: channel && channel !== "NA" ? channel : uploader && uploader !== "NA" ? uploader : "",
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  }
  return items;
}

/** Resolves a direct, ad-free media URL for in-app streaming (not saved to
 * disk) — the whole point of not using YouTube's own embedded player. */
export async function getDirectStreamUrl(videoId: string): Promise<string> {
  await ensureYtDlp();
  const stdout = await runWithRetry(
    [videoUrl(videoId), "-f", "best[ext=mp4]/best", "--get-url", "--no-warnings"],
    40_000,
    1
  );
  const url = stdout.trim().split("\n").at(-1);
  if (!url) throw new Error(`yt-dlp returned no stream URL for ${videoId}`);
  return url;
}
