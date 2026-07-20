// Vyact — YouTube URL helpers for Insight-card video shorts (v9.9.0).
// Admin pastes whatever URL form YouTube gives them (watch/shorts/youtu.be/embed);
// this normalises it to a video id so the consumer can build both a privacy-
// enhanced embed URL (youtube-nocookie) and a canonical watch URL for redirection.

const PATTERNS = [
  /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
  /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  /(?:youtube\.com\/embed\/)([\w-]{11})/,
  /(?:youtu\.be\/)([\w-]{11})/,
];

/** Extracts the 11-char YouTube video id from any common URL shape. Returns null if unrecognised. */
export function extractYouTubeId(url: string): string | null {
  const trimmed = url.trim();
  for (const re of PATTERNS) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  // Bare 11-char id pasted directly (no URL).
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

/** Privacy-enhanced, no-autoplay embed URL for the in-app player. */
export function youtubeEmbedUrl(idOrUrl: string): string | null {
  const id = extractYouTubeId(idOrUrl);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
}

/** Canonical watch URL — for "Open in YouTube" (like/comment/subscribe there). */
export function youtubeWatchUrl(idOrUrl: string): string | null {
  const id = extractYouTubeId(idOrUrl);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
