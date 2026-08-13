import { useEffect, useState } from "react";
import { api, feedUrl } from "../lib/api";
import { CheckIcon } from "../lib/icons";

export function Settings() {
  const [token, setToken] = useState<string | null>(null);
  const [cronSecret, setCronSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [cookiesText, setCookiesText] = useState("");
  const [uploadingCookies, setUploadingCookies] = useState(false);
  const [cookiesMsg, setCookiesMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .feedToken()
      .then((res) => {
        setToken(res.token);
        setCronSecret(res.cronSecret);
      })
      .catch((err) => setError(err.message));
  }, []);

  const url = token ? feedUrl(token) : null;

  async function handleUploadCookies() {
    if (!cronSecret || !cookiesText.trim()) return;
    setUploadingCookies(true);
    setCookiesMsg(null);
    try {
      await api.uploadCookies(cookiesText, cronSecret);
      setCookiesMsg("Cookies saved — Play/Download should work now.");
      setCookiesText("");
    } catch (err: any) {
      setCookiesMsg(`Failed: ${err.message}`);
    } finally {
      setUploadingCookies(false);
    }
  }

  return (
    <div className="settings">
      <p className="hint">This app runs entirely from this one address — there's no backend URL to configure.</p>

      {error && <p className="error">{error}</p>}

      {url && (
        <div className="feed-box">
          <h2>Podcast feed</h2>
          <p>Add this private RSS URL in Apple Podcasts, Overcast, or any podcast app:</p>
          <code>{url}</code>
          <button
            className="btn ghost"
            onClick={() => {
              navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? (
              <>
                <CheckIcon size={13} />
                Copied
              </>
            ) : (
              "Copy link"
            )}
          </button>
        </div>
      )}

      <p className="hint">
        Tip: on iPhone/iPad, tap the Share icon in Safari and choose "Add to Home Screen" to install this as an
        app.
      </p>

      <div className="feed-box">
        <h2>YouTube cookies</h2>
        <p>
          YouTube blocks Play/Download from cloud servers unless we authenticate as a real signed-in session. On
          a computer, install a "cookies.txt" export extension (e.g. "Get cookies.txt LOCALLY" for
          Chrome/Firefox), sign in to youtube.com, export cookies for youtube.com, then paste the file contents
          below.
        </p>
        <textarea
          value={cookiesText}
          onChange={(e) => setCookiesText(e.target.value)}
          placeholder="# Netscape HTTP Cookie File&#10;.youtube.com  TRUE  /  ..."
          rows={6}
          style={{ fontFamily: "monospace", fontSize: "0.8rem", resize: "vertical" }}
        />
        <button
          className="btn primary"
          onClick={handleUploadCookies}
          disabled={uploadingCookies || !cookiesText.trim() || !cronSecret}
        >
          {uploadingCookies ? "Uploading…" : "Save cookies"}
        </button>
        {cookiesMsg && <p className="hint">{cookiesMsg}</p>}
        <p className="hint">
          Cookies expire periodically (usually every few months) — if Play/Download starts failing again with a
          "sign in to confirm you're not a bot" error, just re-export and re-upload here.
        </p>
      </div>
    </div>
  );
}
