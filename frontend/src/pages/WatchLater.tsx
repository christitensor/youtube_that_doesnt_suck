import { useEffect, useRef, useState } from "react";
import { api, type VideoRow } from "../lib/api";

// How often (seconds of playback) to persist resume position while playing.
const PROGRESS_SAVE_INTERVAL = 10;

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function WatchLater() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: string; url: string; resumeSeconds: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedRef = useRef(0);

  async function refresh() {
    try {
      setError(null);
      setVideos(await api.listVideos());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSync() {
    setBusy("sync");
    try {
      await api.sync();
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDownloadAll() {
    setBusy("download-all");
    try {
      const res = await api.downloadAll();
      alert(`Queued ${res.queued} video(s) for download. Refresh in a bit to see progress.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handlePlay(video: VideoRow) {
    setBusy(video.video_id);
    try {
      const { url } = await api.streamUrl(video.video_id);
      lastSavedRef.current = video.resume_seconds;
      setPlaying({ id: video.video_id, url, resumeSeconds: video.resume_seconds });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function closePlayer() {
    const el = videoRef.current;
    if (playing && el && !el.ended) {
      api.saveProgress(playing.id, el.currentTime).catch(() => {});
    }
    setPlaying(null);
  }

  function handleTimeUpdate() {
    const el = videoRef.current;
    if (!playing || !el) return;
    if (Math.abs(el.currentTime - lastSavedRef.current) >= PROGRESS_SAVE_INTERVAL) {
      lastSavedRef.current = el.currentTime;
      api.saveProgress(playing.id, el.currentTime).catch(() => {});
    }
  }

  async function handleEnded() {
    if (!playing) return;
    try {
      await api.markCompleted(playing.id);
    } catch {
      // non-fatal - it'll just linger in the queue until the next successful call
    }
    setPlaying(null);
    refresh();
  }

  async function handleDownloadVideo(video: VideoRow) {
    setBusy(video.video_id);
    try {
      await api.downloadVideo(video.video_id);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="status">Loading…</p>;

  return (
    <div>
      <div className="toolbar">
        <button onClick={handleSync} disabled={busy === "sync"}>
          {busy === "sync" ? "Syncing…" : "Sync now"}
        </button>
        <button onClick={handleDownloadAll} disabled={busy === "download-all"} className="primary">
          {busy === "download-all" ? "Queuing…" : "Download all to device"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {playing && (
        <div className="player-overlay" onClick={closePlayer}>
          <video
            ref={videoRef}
            src={playing.url}
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
            onLoadedMetadata={(e) => {
              if (playing.resumeSeconds > 0) e.currentTarget.currentTime = playing.resumeSeconds;
            }}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
          />
        </div>
      )}

      {videos.length === 0 && !error && (
        <p className="status">
          No videos yet. Add some to your watch-later playlist on YouTube, then hit Sync now.
        </p>
      )}

      <ul className="video-list">
        {videos.map((v) => (
          <li key={v.video_id} className="video-card">
            <img src={v.thumbnail_url ?? ""} alt="" loading="lazy" />
            <div className="video-info">
              <h3>{v.title}</h3>
              <p className="meta">
                {v.channel_title} · {formatDuration(v.duration_seconds)}
                {v.is_podcast === 1 && <span className="badge">🎙 podcast</span>}
                {v.video_download_status === "ready" && <span className="badge">HD ready</span>}
              </p>
              <div className="video-actions">
                <button onClick={() => handlePlay(v)} disabled={busy === v.video_id}>
                  ▶ Play (ad-free)
                </button>
                <button
                  onClick={() => handleDownloadVideo(v)}
                  disabled={busy === v.video_id || v.video_download_status === "ready"}
                >
                  {v.video_download_status === "ready" ? "Downloaded ✓" : "Download"}
                </button>
                {v.video_download_status === "ready" && (
                  <a href={`/api/videos/${v.video_id}/video-file`} download className="save-link">
                    Save to device
                  </a>
                )}
                {v.is_podcast === 1 && v.audio_download_status === "ready" && (
                  <a href={`/api/videos/${v.video_id}/audio-file`} download className="save-link">
                    MP3
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
