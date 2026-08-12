// Optional YouTube cookies (Netscape cookies.txt format), used to
// authenticate yt-dlp as Chris's logged-in browser session. Datacenter IPs
// (Vercel, Sandbox) get blocked by YouTube's bot-check on most anonymous
// requests; passing cookies from a real signed-in session is the reliable
// fix. Stored as a private Blob so no dashboard env var setup is needed.
import { put, get } from "@vercel/blob";

const COOKIES_PATHNAME = "secrets/cookies.txt";

export async function readCookiesText(): Promise<string | null> {
  try {
    const result = await get(COOKIES_PATHNAME, { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    const text = await new Response(result.stream).text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

const NETSCAPE_HEADER = "# Netscape HTTP Cookie File";

export async function writeCookiesText(text: string): Promise<void> {
  // yt-dlp (via Python's http.cookiejar) refuses to load a cookies.txt that
  // doesn't start with this exact magic comment line - most browser cookie
  // export extensions (e.g. Cookie Editor) skip it since it's Netscape/curl
  // convention rather than part of the actual data, so add it if missing
  // instead of making the upload fail.
  const trimmed = text.trim();
  const normalized = trimmed.startsWith("#") ? trimmed : `${NETSCAPE_HEADER}\n${trimmed}`;

  await put(COOKIES_PATHNAME, `${normalized}\n`, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain",
  });
}
