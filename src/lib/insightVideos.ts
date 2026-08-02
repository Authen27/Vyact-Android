// Vyact — evergreen card media links (v9.9.0 video, v9.9.1 infographic).
// The 116 evergreen cards render from bundled JSON (lib/evergreen.ts), but
// per-card video_url / infographic_url are admin-authored in content_items
// (same table the DB seed for these cards lives in, keyed by the same slug
// === card.id). This does one small read to build a slug → media map so
// EvergreenLearn can merge it onto the bundled cards without touching the
// JSON asset.
import { sb } from './supabase';

export interface CardMedia { video_url: string | null; infographic_url: string | null }

export async function fetchEvergreenMedia(): Promise<Map<string, CardMedia>> {
  const { data, error } = await sb()
    .from('content_items')
    .select('slug,video_url,infographic_url')
    .eq('format', 'card')
    .or('video_url.not.is.null,infographic_url.not.is.null');
  if (error) throw error;
  return new Map((data as { slug: string; video_url: string | null; infographic_url: string | null }[])
    .map(r => [r.slug, { video_url: r.video_url, infographic_url: r.infographic_url }]));
}
