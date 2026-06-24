// Vyact — evergreen card library loader (Insights Hub §4, v9.5.3).
//
// The "Learn" stream: 100+ one-time-authored educational cards bundled as a
// static asset (react/src/data/evergreenCards.json). Visuals render from CODE
// (icon / stat / diagram / arc / arrow / compare2 — see CardVisual.tsx), so there
// are no hosted images. For v1 these ship client-side; the spec's DB/admin
// authoring path (content_items format='card') is a later additive step.

import library from '../data/evergreenCards.json';

export type CardTone = 'neutral' | 'positive' | 'constructive';
export type VisualKind = 'stat' | 'icon' | 'diagram' | 'arc' | 'arrow' | 'compare2';

export interface StatRef { big: string; sub?: string }
export interface StackRef { primitive: 'stack'; parts: [string, number][] }
export interface Bar2Ref { primitive: 'bar2'; a: [string, number]; b: [string, number] }
export interface ArcRef { primitive: 'arc'; pct: number; label?: string }
export interface ArrowRef { primitive: 'arrow'; dir: 'up' | 'down'; label?: string }
export interface Compare2Ref { primitive: 'compare2'; a: string; b: string }
export type VisualRef = string | StatRef | StackRef | Bar2Ref | ArcRef | ArrowRef | Compare2Ref;

export interface EvergreenCard {
  id: string;
  format: 'card';
  category: string;
  title: string;
  visual_kind: VisualKind;
  visual_ref: VisualRef;
  body_md: string;
  tags: string[];
  reading_seconds: number;
  tone: CardTone;
  india_relevant: boolean;
  published: boolean;
}

const ALL: EvergreenCard[] = (library.cards as EvergreenCard[]).filter(c => c.published);

/** Every published evergreen card, in authored order. */
export function allEvergreenCards(): EvergreenCard[] { return ALL; }

/** Distinct categories in authored order (Saving, Debt, …). */
export const EVERGREEN_CATEGORIES: string[] = [...new Set(ALL.map(c => c.category))];

/** Reading-time chip label, e.g. "30s read". */
export function readingChip(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min read` : `${seconds}s read`;
}

/** Search + category filter over the library. Empty query/`all` returns the set. */
export function filterEvergreen(query: string, category: string | 'all'): EvergreenCard[] {
  const q = query.trim().toLowerCase();
  return ALL.filter(c => {
    if (category !== 'all' && c.category !== category) return false;
    if (!q) return true;
    return c.title.toLowerCase().includes(q)
      || c.body_md.toLowerCase().includes(q)
      || c.category.toLowerCase().includes(q)
      || c.tags.some(t => t.toLowerCase().includes(q));
  });
}

/** Contextual surfacing (spec §4): first published card matching any of the tags.
 *  Used by the For You feed's nudge_to_learn cards to deep-link a relevant lesson. */
export function evergreenByTag(tags: string[]): EvergreenCard | undefined {
  return ALL.find(c => c.tags.some(t => tags.includes(t)));
}

// ── Local favorites ─────────────────────────────────────────────────────────
// Evergreen cards are bundled, not DB rows, so favorites live in localStorage
// (the DB content_favorites table keys on content_item ids — wiring these in is
// part of the deferred admin/DB step). Best-effort; never throws.
const FAV_KEY = 'vyact_evergreen_favs';

export function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export function saveFavorites(ids: Set<string>): void {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...ids])); } catch { /* noop */ }
}
