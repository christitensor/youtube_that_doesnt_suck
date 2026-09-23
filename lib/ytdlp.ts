// Runs yt-dlp inside a Vercel Node Function. Functions get a writable /tmp
// and outbound network access but no pre-installed binaries, so we fetch the
// self-contained yt-dlp Linux executable into /tmp on cold start and shell
// out to it. No YouTube API key involved anywhere — yt-dlp scrapes the
// public (unlisted) playlist/video pages directly.
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { readCookiesText } from "./cookies.js";
import { POT_PLUGIN_FILES } from "./potPluginFiles.js";

const YTDLP_PATH = "/tmp/yt-dlp";
const YTDLP_DOWNLOAD_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
const COOKIES_PATH = "/tmp/cookies.txt";

// As of ~Aug 2026 cookies alone stopped being enough to pass YouTube's
// bot-check from datacenter IPs (which every Vercel Function/Sandbox is) -
// YouTube also scores a BotGuard-minted Proof-of-Origin token. This is a
// free, self-hosted token generator (Rust, single static binary, no
// npm/canvas native-compile risk unlike the original TS implementation):
// https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs
// It plugs into yt-dlp as a "script/CLI" PO token provider - yt-dlp shells
// out to it per request rather than needing an always-on server, which
// fits a stateless Function. Confirmed locally: the plugin loads and
// registers correctly (`PO Token Providers: bgutil:cli... (external)`).
const POT_BIN_PATH = "/tmp/bgutil-pot";
const POT_BIN_DOWNLOAD_URL =
  "https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-x86_64";
// Must be nested one level under the plugin-dirs root as
// <package name>/yt_dlp_plugins/... - yt-dlp's plugin loader requires that
// exact shape (confirmed locally; a flat yt_dlp_plugins/ at the root is
// silently ignored, logged as "Plugin directories: none").
const POT_PLUGIN_DIRS_ROOT = "/tmp/yt-dlp-plugins";
const POT_PLUGIN_PKG_DIR = path.join(POT_PLUGIN_DIRS_ROOT, "bgutil-ytdlp-pot-provider", "yt_dlp_plugins", "extractor");

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

let potProviderPromise: Promise<boolean> | null = null;

/** Downloads the bgutil-pot binary and writes the vendored plugin files into
 * /tmp once per cold start. Returns whether the provider is ready to use.
 * Failure here should never take down Play/Download - cookies alone still
 * work for some requests, so this degrades to "no PO token" rather than
 * throwing. */
async function ensurePotProvider(): Promise<boolean> {
  if (fs.existsSync(POT_BIN_PATH) && fs.existsSync(POT_PLUGIN_PKG_DIR)) return true;
  if (!potProviderPromise) {
    potProviderPromise = (async () => {
      try {
        await fsp.mkdir(POT_PLUGIN_PKG_DIR, { recursive: true });
        await Promise.all(
          Object.entries(POT_PLUGIN_FILES).map(([name, contents]) =>
            fsp.writeFile(path.join(POT_PLUGIN_PKG_DIR, name), contents, { mode: 0o644 })
          )
        );
        const res = await fetch(POT_BIN_DOWNLOAD_URL, { redirect: "follow" });
        if (!res.ok) throw new Error(`Failed to download bgutil-pot binary: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fsp.writeFile(POT_BIN_PATH, buf, { mode: 0o755 });
        await fsp.chmod(POT_BIN_PATH, 0o755);
        return true;
      } catch (err) {
        console.error("[ytdlp] PO token provider setup failed, continuing without it:", err);
        return false;
      }
    })();
  }
  return potProviderPromise;
}

async function potArgs(): Promise<string[]> {
  return (await ensurePotProvider())
    ? ["--plugin-dirs", POT_PLUGIN_DIRS_ROOT, "--extractor-args", `youtubepot-bgutilcli:cli_path=${POT_BIN_PATH}`]
    : [];
}

let cookiesPromise: Promise<boolean> | null = null;

/** Writes /tmp/cookies.txt from the stored Blob cookies (if any) once per
 * cold start. Returns whether a cookies file is available to pass to yt-dlp. */
async function ensureCookiesFile(): Promise<boolean> {
  if (fs.existsSync(COOKIES_PATH)) return true;
  if (!cookiesPromise) {
    cookiesPromise = (async () => {
      const text = await readCookiesText();
      if (!text) return false;
      await fsp.writeFile(COOKIES_PATH, text, { mode: 0o600 });
      return true;
    })();
  }
  return cookiesPromise;
}

async function cookieArgs(): Promise<string[]> {
  return (await ensureCookiesFile()) ? ["--cookies", COOKIES_PATH] : [];
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

// YouTube gates most real formats behind an obfuscated "n" signature
// challenge that yt-dlp needs a JS runtime to solve - without one, requests
// silently degrade to storyboard-only or SABR-gated formats with no usable
// URL, regardless of cookies. Vercel Node Functions already run on Node, so
// point yt-dlp at that same binary instead of needing a separate install.
const JS_RUNTIME_ARGS = ["--js-runtimes", `node:${process.execPath}`];

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
      ...JS_RUNTIME_ARGS,
      ...(await cookieArgs()),
      ...(await potArgs()),
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

async function resolveStreamUrl(videoId: string, playerClient: string | null, timeoutMs = 40_000): Promise<string> {
  const clientArgs = playerClient ? ["--extractor-args", `youtube:player_client=${playerClient}`] : [];
  const stdout = await runWithRetry(
    [
      videoUrl(videoId),
      "-f",
      "best[ext=mp4]/best",
      "--get-url",
      "--no-warnings",
      ...clientArgs,
      ...JS_RUNTIME_ARGS,
      ...(await cookieArgs()),
      ...(await potArgs()),
    ],
    timeoutMs,
    0
  );
  const url = stdout.trim().split("\n").at(-1);
  if (!url) throw new Error(`yt-dlp returned no stream URL for ${videoId}`);
  return url;
}

/** Resolves a direct, ad-free media URL for in-app streaming (not saved to
 * disk) — the whole point of not using YouTube's own embedded player. */
export async function getDirectStreamUrl(videoId: string): Promise<string> {
  await ensureYtDlp();
  // As of ~Aug 2026 YouTube scores requests on IP reputation + a
  // BotGuard-minted Proof-of-Origin token, not just on having a valid
  // cookie - datacenter IPs (which is what every Vercel Function/Sandbox
  // is) get bot-walled even with fresh cookies and even with yt-dlp's
  // default multi-client fallback (confirmed in prod: both "tv" and the
  // unpinned default failed with the same "Sign in to confirm you're not
  // a bot" error from this environment, despite freshly re-exported
  // cookies). "android"/"ios" sometimes sidestep the check where "tv" and
  // the default set don't, so try those before giving up. This is not a
  // durable fix - if YouTube closes this gap too, the real fix is a PO
  // token provider or a residential/mobile proxy, not another client name.
  // Function's maxDuration is 45s (vercel.json) - budget attempts so up to
  // 4 sequential tries fit with room to spare. The unpinned default gets
  // the largest share since it queries multiple player APIs internally.
  const attempts: [string | null, number][] = [
    ["tv", 8_000],
    ["android", 8_000],
    ["ios", 8_000],
    [null, 15_000],
  ];
  let lastErr: unknown;
  for (const [client, timeoutMs] of attempts) {
    try {
      return await resolveStreamUrl(videoId, client, timeoutMs);
    } catch (err) {
      lastErr = err;
      console.error(`[ytdlp] client "${client ?? "default"}" failed for ${videoId}:`, err);
    }
  }
  throw lastErr;
}
