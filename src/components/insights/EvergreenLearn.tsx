// Vyact — "Learn" tab (Insights Hub): the evergreen lesson library. Lessons are
// searchable, favoritable, shareable (public /learn/<slug>), and viewable as a
// full-screen shorts reel.
//
// v10.52.0 (owner) — the Lessons / Updates segment is gone. Updates (the former
// What's New feed) only ever held 5 legacy articles, archived 1 Oct 2026 (to-do #15),
// and without cloud sync it was a dead end. Learn is now just search, filters, lessons.
import { useEffect, useMemo, useState } from 'react';
import { Search, Heart, Clock, Share2, Sparkles } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import CardVisual from './CardVisual';
import EvergreenReel from './EvergreenReel';
import {
  filterEvergreen, readingChip, EVERGREEN_CATEGORIES,
  loadFavorites, saveFavorites, type EvergreenCard,
} from '../../lib/evergreen';
import { shareEvergreen } from '../../lib/share';
import { fetchEvergreenMedia, type CardMedia } from '../../lib/insightVideos';
import { isCloudEnabled } from '../../lib/supabase';

function withMedia(card: EvergreenCard, media: Map<string, CardMedia>): EvergreenCard {
  const m = media.get(card.id);
  return m ? { ...card, video_url: m.video_url, infographic_url: m.infographic_url } : card;
}

interface Props {
  openId?: string | null;
  onConsumedOpen?: () => void;
  /** Aurora 4.0 LN1 — lessons the household's review points to, with the reason (at most two). */
  suggested?: { id: string; reason: string }[];
  /** v10.107.0 — a search to start with (Pip's "Lessons on …" link: /insights?tab=learn&q=…). */
  initialQuery?: string;
}

export default function EvergreenLearn({ openId, onConsumedOpen, suggested = [], initialQuery }: Props) {
  const [query, setQuery] = useState(() => (initialQuery ?? '').slice(0, 60));
  const [category, setCategory] = useState<string | 'all'>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  // Every card opens through the universal reel viewer (v9.9.1) — { cards, index }
  // rather than a single "reading" card, since the viewer is swipeable across
  // whichever list it was opened from (the filtered grid, or a deep-linked
  // single-card list).
  const [reel, setReel] = useState<{ cards: EvergreenCard[]; index: number } | null>(null);
  const [media, setMedia] = useState<Map<string, CardMedia>>(new Map());

  // Video/infographic links are admin-authored in content_items (v9.9.0/v9.9.1);
  // best-effort — a fetch failure just means cards fall back to text-only, never
  // breaks the tab.
  useEffect(() => {
    if (!isCloudEnabled()) return;
    fetchEvergreenMedia().then(setMedia).catch(() => {});
  }, []);

  // Honor a deep-link open request from the feed reel.
  useEffect(() => {
    if (!openId) return;
    const full = filterEvergreen('', 'all').map(c => withMedia(c, media));
    const idx = full.findIndex(c => c.id === openId);
    if (idx !== -1) setReel({ cards: full, index: idx });
    onConsumedOpen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  function toggleFav(id: string) {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveFavorites(next);
      return next;
    });
  }

  const suggestedCards = useMemo(() => suggested
    .map(s => ({ ...s, card: filterEvergreen('', 'all').find(c => c.id === s.id) }))
    .filter((s): s is { id: string; reason: string; card: EvergreenCard } => !!s.card), [suggested]);

  function openLesson(id: string) {
    const full = filterEvergreen('', 'all').map(c => withMedia(c, media));
    const idx = full.findIndex(c => c.id === id);
    if (idx !== -1) setReel({ cards: full, index: idx });
  }

  const cards = useMemo(() => {
    let f = filterEvergreen(query, category);
    if (favOnly) f = f.filter(c => favorites.has(c.id));
    return f.map(c => withMedia(c, media));
  }, [query, category, favOnly, favorites, media]);

  return (
    <div>
          {/* The toolbar slot directly under the page header. For You puts its
              "Play highlights" button in this same slot (Insights.tsx). */}
          <div className="flex flex-col gap-2.5 mb-4" data-testid="insights-toolbar">
            <div className="relative min-w-0 max-w-xl">
              <Search size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim pointer-events-none" />
              <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search lessons"
                placeholder="Search lessons — saving, EMI, SIP, runway…" className="input has-leading-icon w-full pl-9" />
            </div>
            <div className="flex gap-1.5 flex-nowrap overflow-x-auto -mx-4 px-4 pb-1 sm:flex-wrap sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: 'none' }} role="group" aria-label="Filter lessons" data-testid="learn-chips">
              <Chip active={category === 'all'} onClick={() => setCategory('all')}>All</Chip>
              {EVERGREEN_CATEGORIES.map(c => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Chip>)}
              <Chip active={favOnly} onClick={() => setFavOnly(v => !v)}><Heart size={11} className={favOnly ? 'fill-current' : ''} /> Saved</Chip>
            </div>
          </div>

          {/* LN1 — "Suggested for you": the lessons your own review points to, and why. */}
          {suggestedCards.length > 0 && !query && category === 'all' && !favOnly && (
            <section aria-labelledby="learn-suggested" className="mb-4" data-testid="learn-suggested">
              <h2 id="learn-suggested" className="ui-label mb-2 flex items-center gap-1.5"><Sparkles size={13} aria-hidden /> Suggested for you</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {suggestedCards.map(s => (
                  <button key={s.id} type="button" onClick={() => openLesson(s.id)}
                    className="tile !rounded-r3 p-4 text-left min-h-[44px]" aria-label={`Open: ${s.card.title}`}>
                    <span className="block font-semibold text-ink text-[0.92rem] leading-snug">{s.card.title}</span>
                    <span className="block text-[12px] text-ink-mid mt-1 leading-snug">{s.reason}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {cards.length === 0 ? (
            <EmptyState icon="🔍" message={favOnly ? 'No saved lessons yet — tap ♡ on a card.' : `No lessons match "${query}"`} />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cards.map((c, i) => (
                <article key={c.id} className="tile !rounded-r3 p-3 flex flex-col">
                  <button onClick={() => setReel({ cards, index: i })} className="text-left" aria-label={`Open: ${c.title}`}>
                    <CardVisual card={c} className="h-28 mb-3" />
                    <span className="ui-label">{c.category}</span>
                    <h3 className="font-semibold text-ink text-[0.92rem] leading-snug mt-0.5 mb-2">{c.title}</h3>
                  </button>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-[12px] text-ink-dim"><Clock size={11} className="inline mr-1" />{readingChip(c.reading_seconds)}</span>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => shareEvergreen(c.id, c.title)} aria-label="Share"
                        className="w-11 h-11 flex items-center justify-center rounded-r2 text-ink-dim hover:text-coral hover:bg-coral-tint transition-colors"><Share2 size={14} /></button>
                      <button onClick={() => toggleFav(c.id)} aria-label={favorites.has(c.id) ? 'Unsave' : 'Save'}
                        className={`w-11 h-11 flex items-center justify-center rounded-r2 transition-colors ${favorites.has(c.id) ? 'text-coral bg-coral-tint' : 'text-ink-dim hover:text-coral hover:bg-coral-tint'}`}>
                        <Heart size={13} className={favorites.has(c.id) ? 'fill-current' : ''} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

      {reel && (
        <EvergreenReel cards={reel.cards} startIndex={reel.index} onClose={() => setReel(null)} />
      )}
    </div>
  );
}

/** Aurora 4.0 LN3 — the standard raised chip at 40px (was a mono-caps tag with a solid coral fill). */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className="flex-shrink-0 inline-flex items-center gap-1.5 h-10 px-3.5 rounded-pill text-[13px] font-medium whitespace-nowrap transition-[box-shadow,color]"
      style={active
        ? { background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: 'var(--neu-sm)' }
        : { background: 'var(--canvas)', color: 'hsl(var(--ink-mid))', boxShadow: 'var(--neu-sm)' }}>
      {children}
    </button>
  );
}
