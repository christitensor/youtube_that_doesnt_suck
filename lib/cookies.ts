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

/** Python's http.cookiejar (which yt-dlp uses) hard-asserts that a cookie
 * line's "include subdomains" flag (2nd field) agrees with whether the
 * domain (1st field) has a leading dot - mismatched rows raise
 * AssertionError and abort loading the *entire* file. Browser cookie-export
 * extensions (e.g. Cookie Editor) routinely emit TRUE without the leading
 * dot, so reconcile them instead of failing the upload. Making TRUE rows
 * domain-wide (".youtube.com") is also what we want functionally, since
 * yt-dlp's requests hit www.youtube.com while these often get exported
 * scoped to m.youtube.com or similar. */
function normalizeNetscapeCookies(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed.startsWith("#")) return trimmed;
      const parts = trimmed.split("\t");
      if (parts.length !== 7) return trimmed;
      const [domain, domainSpecified, path, secure, expires, name, value] = parts;
      const hasDot = domain.startsWith(".");
      let fixedDomain = domain;
      if (domainSpecified === "TRUE" && !hasDot) fixedDomain = `.${domain}`;
      else if (domainSpecified === "FALSE" && hasDot) fixedDomain = domain.slice(1);
      return [fixedDomain, domainSpecified, path, secure, expires, name, value].join("\t");
    })
    .join("\n");
}

export async function writeCookiesText(text: string): Promise<void> {
  // yt-dlp (via Python's http.cookiejar) refuses to load a cookies.txt that
  // doesn't start with this exact magic comment line - most browser cookie
  // export extensions (e.g. Cookie Editor) skip it since it's Netscape/curl
  // convention rather than part of the actual data, so add it if missing
  // instead of making the upload fail.
  const trimmed = text.trim();
  const withHeader = trimmed.startsWith("#") ? trimmed : `${NETSCAPE_HEADER}\n${trimmed}`;
  const normalized = normalizeNetscapeCookies(withHeader);

  await put(COOKIES_PATHNAME, `${normalized}\n`, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain",
  });
}
