import { useEffect, useState } from "react";
import { api, feedUrl } from "../lib/api";

export function Settings() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .feedToken()
      .then((res) => setToken(res.token))
      .catch((err) => setError(err.message));
  }, []);

  const url = token ? feedUrl(token) : null;

  return (
    <div className="settings">
      <p className="hint">
        This app runs entirely from this one address — there's no backend URL to configure.
      </p>

      {error && <p className="error">{error}</p>}

      {url && (
        <div className="feed-box">
          <p>Your private podcast RSS feed — add this URL in Apple Podcasts, Overcast, or any podcast app:</p>
          <code>{url}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      )}

      <p className="hint">
        Tip: on iPhone/iPad, tap the Share icon in Safari and choose "Add to Home Screen" to install this
        as an app.
      </p>
    </div>
  );
}
