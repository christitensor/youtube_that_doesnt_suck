import { useState } from "react";
import { api, getBackendUrl, setBackendUrl } from "../lib/api";

export function Settings() {
  const [url, setUrl] = useState(getBackendUrl());
  const [feedToken, setFeedToken] = useState(localStorage.getItem("ytdns_feed_token") ?? "");
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setBackendUrl(url);
    localStorage.setItem("ytdns_feed_token", feedToken);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const feedUrl = feedToken ? api.feedUrl(feedToken) : null;

  return (
    <div className="settings">
      <label>
        Backend URL
        <input
          type="url"
          placeholder="https://your-app.fly.dev"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>

      <label>
        Podcast feed token
        <input
          type="text"
          placeholder="the FEED_TOKEN you set in the backend .env"
          value={feedToken}
          onChange={(e) => setFeedToken(e.target.value)}
        />
      </label>

      <button onClick={handleSave} className="primary">
        {saved ? "Saved ✓" : "Save"}
      </button>

      {feedUrl && (
        <div className="feed-box">
          <p>Your private podcast RSS feed — add this URL in Apple Podcasts, Overcast, or any podcast app:</p>
          <code>{feedUrl}</code>
          <button onClick={() => navigator.clipboard.writeText(feedUrl)}>Copy</button>
        </div>
      )}

      <p className="hint">
        Tip: on iPhone/iPad, tap the Share icon in Safari and choose "Add to Home Screen" to install this
        as an app.
      </p>
    </div>
  );
}
