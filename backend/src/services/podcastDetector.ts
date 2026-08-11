export type PodcastClassification = { isPodcast: boolean; reason: string };

const TITLE_KEYWORDS = [
  "podcast", "episode", "ep.", "ep #", "#ep", "interview", "conversation with",
  "in conversation", "the ", // used only combined with "show"/"podcast" below
];

const STRONG_TITLE_KEYWORDS = ["podcast", "episode", "ep.", "interview"];
const CHANNEL_KEYWORDS = ["podcast", "radio", "show"];
const MIN_DURATION_SECONDS = 20 * 60; // 20 minutes

/**
 * Rule-based heuristic: no ML model, just signals that correlate with
 * long-form talk content (podcasts) vs. typical short YouTube videos.
 */
export function classifyPodcast(input: {
  title: string;
  description: string;
  channelTitle: string;
  durationSeconds: number;
}): PodcastClassification {
  const title = input.title.toLowerCase();
  const channel = input.channelTitle.toLowerCase();
  const description = input.description.toLowerCase();

  const reasons: string[] = [];

  const hasStrongTitleKeyword = STRONG_TITLE_KEYWORDS.some((k) => title.includes(k));
  if (hasStrongTitleKeyword) reasons.push("title mentions podcast/episode/interview");

  const hasChannelKeyword = CHANNEL_KEYWORDS.some((k) => channel.includes(k));
  if (hasChannelKeyword) reasons.push("channel name suggests a podcast/show");

  const isLongForm = input.durationSeconds >= MIN_DURATION_SECONDS;
  if (isLongForm) reasons.push(`long-form (${Math.round(input.durationSeconds / 60)} min)`);

  const mentionsListenPlatforms = /spotify|apple podcasts|itunes|audio version|listen on/.test(description);
  if (mentionsListenPlatforms) reasons.push("description links to podcast platforms");

  // Require long-form duration AND at least one other signal, to avoid
  // flagging every 25-minute video as a podcast.
  const isPodcast = isLongForm && (hasStrongTitleKeyword || hasChannelKeyword || mentionsListenPlatforms);

  return {
    isPodcast,
    reason: reasons.length ? reasons.join("; ") : "no podcast signals detected",
  };
}
