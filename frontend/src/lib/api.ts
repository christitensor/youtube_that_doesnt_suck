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
  video_file_path: string | null;
  video_file_bytes: number | null;
  audio_download_status: "none" | "downloading" | "ready" | "failed";
  audio_file_path: string | null;
  audio_file_bytes: number | null;
  watched: 0 | 1;
  resume_seconds: number;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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
  sync: () => req<{ added: number; total: number }>("/api/sync"),
  streamUrl: (id: string) => req<{ url: string }>(`/api/videos/${id}/stream-url`),
  downloadVideo: (id: string) => req(`/api/videos/${id}/download`, { method: "POST" }),
  downloadAudio: (id: string) => req(`/api/videos/${id}/download-audio`, { method: "POST" }),
  downloadAll: () => req<{ queued: number; remaining: number }>("/api/download-all", { method: "POST" }),
  saveProgress: (id: string, resumeSeconds: number) =>
    req(`/api/videos/${id}/watched`, { method: "POST", body: JSON.stringify({ resumeSeconds }) }),
  markCompleted: (id: string) =>
    req(`/api/videos/${id}/watched`, { method: "POST", body: JSON.stringify({ completed: true }) }),
  feedToken: () => req<{ token: string }>("/api/feed-token"),
};

/** Builds the private podcast RSS feed URL from the current page origin —
 * this app is served from a single Vercel deployment, so there's no
 * separate "backend URL" to configure anymore. */
export function feedUrl(token: string): string {
  return `${window.location.origin}/api/feed/${token}.xml`;
}
