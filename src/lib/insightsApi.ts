// Vyact v6.3 — Insights / Content API (consumer side)
// Reads from public.content_items (only published rows visible per RLS) and
// manages user-scoped favorites in public.content_favorites.

import { sb } from './supabase';

export interface InsightArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  topic: 'debt' | 'tax' | 'investment' | 'budgeting' | 'savings' | 'retirement';
  authorName: string;
  readMinutes: number;
  coverEmoji: string;
  publishedAt: string;
}

interface ContentRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  topic: InsightArticle['topic'];
  status: 'draft' | 'review' | 'published' | 'archived';
  author_name: string;
  read_minutes: number;
  cover_emoji: string | null;
  published_at: string | null;
}

function rowToArticle(r: ContentRow): InsightArticle {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary ?? '',
    body: r.body,
    topic: r.topic,
    authorName: r.author_name,
    readMinutes: r.read_minutes,
    coverEmoji: r.cover_emoji ?? '📰',
    publishedAt: r.published_at ?? '',
  };
}

export async function listPublishedContent(): Promise<InsightArticle[]> {
  // v9.5.3 — the Insights Hub seeds 116 evergreen lessons as format='card' in this
  // same table. Those belong in the Learn tab, NOT What's New, so we exclude them
  // here and surface only editorial 'article' + curated 'external' items.
  const { data, error } = await sb()
    .from('content_items')
    .select('id,slug,title,summary,body,topic,status,author_name,read_minutes,cover_emoji,published_at')
    .eq('status', 'published')
    .in('format', ['article', 'external'])
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data as ContentRow[]).map(rowToArticle);
}

export async function listFavoriteIds(): Promise<Set<string>> {
  const { data, error } = await sb()
    .from('content_favorites').select('content_id');
  if (error) throw error;
  return new Set((data as { content_id: string }[]).map(r => r.content_id));
}

export async function addFavorite(contentId: string) {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await sb()
    .from('content_favorites')
    .insert({ user_id: user.id, content_id: contentId });
  if (error && error.code !== '23505') throw error;  // ignore duplicate-PK
}

export async function removeFavorite(contentId: string) {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) return;
  const { error } = await sb()
    .from('content_favorites')
    .delete()
    .eq('user_id', user.id)
    .eq('content_id', contentId);
  if (error) throw error;
}
