export type VideoRow = {
  video_id: string;
  title: string;
  channel_title: string | null;
  description: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  published_at: string | null;
  added_at: string;
  is_podcast: 0 | 1;
  podcast_reason: string | null;
  video_download_status: "none" | "downloading" | "ready" | "failed";
  video_file_bytes: number | null;
  audio_download_status: "none" | "downloading" | "ready" | "failed";
  audio_file_bytes: number | null;
  watched: 0 | 1;
};

const BASE_URL_KEY = "ytdns_backend_url";

export function getBackendUrl(): string {
  return localStorage.getItem(BASE_URL_KEY) ?? "";
}

export function setBackendUrl(url: string) {
  localStorage.setItem(BASE_URL_KEY, url.replace(/\/$/, ""));
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBackendUrl();
  if (!base) throw new Error("Set your backend URL in Settings first.");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${body}`);
  }
  return res.json();
}

export const api = {
  listVideos: () => req<VideoRow[]>("/api/videos"),
  sync: () => req<{ added: number; total: number }>("/api/sync", { method: "POST" }),
  streamUrl: (id: string) => req<{ url: string }>(`/api/videos/${id}/stream-url`),
  downloadVideo: (id: string) => req(`/api/videos/${id}/download`, { method: "POST" }),
  downloadAudio: (id: string) => req(`/api/videos/${id}/download-audio`, { method: "POST" }),
  downloadAll: () => req<{ queued: number }>("/api/download-all", { method: "POST" }),
  markWatched: (id: string) => req(`/api/videos/${id}/watched`, { method: "POST" }),
  videoFileUrl: (id: string) => `${getBackendUrl()}/api/videos/${id}/video-file`,
  audioFileUrl: (id: string) => `${getBackendUrl()}/api/videos/${id}/audio-file`,
  feedUrl: (token: string) => `${getBackendUrl()}/feed/${token}.xml`,
};
