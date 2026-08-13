import { useEffect, useRef, useState } from "react";
import { api, type VideoRow } from "../lib/api";
import { PlayIcon, DownloadIcon, CheckIcon, SyncIcon, MicIcon, SparkleIcon, CloseIcon, SaveIcon } from "../lib/icons";

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
        <button className="btn ghost" onClick={handleSync} disabled={busy === "sync"}>
          <SyncIcon size={14} />
          {busy === "sync" ? "Syncing…" : "Sync"}
        </button>
        <button className="btn primary" onClick={handleDownloadAll} disabled={busy === "download-all"}>
          <DownloadIcon size={14} />
          {busy === "download-all" ? "Queuing…" : "Download all"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {playing && (
        <div className="player-overlay" onClick={closePlayer}>
          <button className="player-close" onClick={closePlayer} aria-label="Close player">
            <CloseIcon size={18} />
          </button>
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
            <div className="thumb-wrap">
              <img src={v.thumbnail_url ?? ""} alt="" loading="lazy" />
              <div className="thumb-badges">
                {v.is_podcast === 1 && (
                  <span className="chip">
                    <MicIcon size={11} />
                    Podcast
                  </span>
                )}
                {v.video_download_status === "ready" && (
                  <span className="chip hd">
                    <SparkleIcon size={11} />
                    HD ready
                  </span>
                )}
              </div>
              {v.duration_seconds ? <span className="duration-chip">{formatDuration(v.duration_seconds)}</span> : null}
            </div>
            <div className="video-info">
              <h3>{v.title}</h3>
              <p className="meta">{v.channel_title}</p>
              <div className="video-actions">
                <button className="btn primary" onClick={() => handlePlay(v)} disabled={busy === v.video_id}>
                  <PlayIcon size={13} />
                  Play
                </button>
                <button
                  className="btn ghost"
                  onClick={() => handleDownloadVideo(v)}
                  disabled={busy === v.video_id || v.video_download_status === "ready"}
                >
                  {v.video_download_status === "ready" ? (
                    <>
                      <CheckIcon size={13} />
                      Downloaded
                    </>
                  ) : (
                    <>
                      <DownloadIcon size={13} />
                      Download
                    </>
                  )}
                </button>
                {v.video_download_status === "ready" && (
                  <a href={`/api/videos/${v.video_id}/video-file`} download className="btn ghost">
                    <SaveIcon size={13} />
                    Save
                  </a>
                )}
                {v.is_podcast === 1 && v.audio_download_status === "ready" && (
                  <a href={`/api/videos/${v.video_id}/audio-file`} download className="btn ghost">
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
