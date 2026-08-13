// Optional YouTube cookies (Netscape cookies.txt format), used to
// authenticate yt-dlp as Chris's logged-in browser session. Datacenter IPs
// (Vercel, Sandbox) get blocked by YouTube's bot-check on most anonymous
// requests; passing cookies from a real signed-in session is the reliable
// fix. Stored as a private Blob so no dashboard env var setup is needed.
import { put, get } from "@vercel/blob";

const COOKIES_PATHNAME = "secrets/cookies.txt";
const NETSCAPE_HEADER = "# Netscape HTTP Cookie File";

/** Fixes up whatever a browser cookie-export extension handed us so yt-dlp
 * (via Python's http.cookiejar) will actually load it:
 *  1. Prepends the magic "# Netscape HTTP Cookie File" comment line, which
 *     most export tools omit even though the loader requires it.
 *  2. Reconciles each row's "include subdomains" flag (2nd field) with
 *     whether its domain (1st field) has a leading dot - the loader
 *     hard-asserts these agree and aborts loading the *entire* file on a
 *     single mismatched row, which export tools produce constantly (e.g.
 *     "m.youtube.com" + TRUE). Making TRUE rows domain-wide is also what we
 *     want functionally, since yt-dlp's requests hit www.youtube.com while
 *     these often get exported scoped to m.youtube.com or similar.
 * Applied on every read (not just on upload) so a cookies.txt saved before
 * this logic existed - or before a fix to it - self-heals without Chris
 * needing to re-paste it into Settings. */
function sanitizeCookiesText(text: string): string {
  const trimmed = text.trim();
  const withHeader = trimmed.startsWith("#") ? trimmed : `${NETSCAPE_HEADER}\n${trimmed}`;

  return withHeader
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const t = line.trimEnd();
      if (!t || t.startsWith("#")) return t;
      const parts = t.split("\t");
      if (parts.length !== 7) return t;
      const [domain, domainSpecified, path, secure, expires, name, value] = parts;
      const hasDot = domain.startsWith(".");
      let fixedDomain = domain;
      if (domainSpecified === "TRUE" && !hasDot) fixedDomain = `.${domain}`;
      else if (domainSpecified === "FALSE" && hasDot) fixedDomain = domain.slice(1);
      return [fixedDomain, domainSpecified, path, secure, expires, name, value].join("\t");
    })
    .join("\n");
}

export async function readCookiesText(): Promise<string | null> {
  try {
    const result = await get(COOKIES_PATHNAME, { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    const text = await new Response(result.stream).text();
    if (!text.trim()) return null;
    return sanitizeCookiesText(text);
  } catch {
    return null;
  }
}

export async function writeCookiesText(text: string): Promise<void> {
  const normalized = sanitizeCookiesText(text);
  await put(COOKIES_PATHNAME, `${normalized}\n`, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain",
  });
}
