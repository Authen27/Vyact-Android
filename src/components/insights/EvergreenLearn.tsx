// Vyact — "Learn" tab (Insights Hub). v9.5.5: combines the evergreen lesson
// library AND editorial/curated "Updates" (the former What's New) under one tab
// via a Lessons/Updates segment. Lessons are searchable, favoritable, shareable
// (public /learn/<slug>), and viewable as a full-screen shorts reel.
import { useEffect, useMemo, useState } from 'react';
import { Search, Heart, Clock, Share2, PlaySquare } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import CardVisual from './CardVisual';
import EvergreenReader from './EvergreenReader';
import EvergreenReel from './EvergreenReel';
import WhatsNew from './WhatsNew';
import {
  filterEvergreen, readingChip, EVERGREEN_CATEGORIES,
  loadFavorites, saveFavorites, type EvergreenCard,
} from '../../lib/evergreen';
import { shareEvergreen } from '../../lib/share';

type Segment = 'lessons' | 'updates';

interface Props {
  openId?: string | null;
  onConsumedOpen?: () => void;
}

export default function EvergreenLearn({ openId, onConsumedOpen }: Props) {
  const [segment, setSegment] = useState<Segment>('lessons');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | 'all'>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [reading, setReading] = useState<EvergreenCard | null>(null);
  const [reelAt, setReelAt] = useState<number | null>(null);

  // Honor a deep-link open request from the feed reel (also forces Lessons).
  useEffect(() => {
    if (!openId) return;
    const card = filterEvergreen('', 'all').find(c => c.id === openId);
    if (card) { setSegment('lessons'); setReading(card); }
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

  const cards = useMemo(() => {
    let f = filterEvergreen(query, category);
    if (favOnly) f = f.filter(c => favorites.has(c.id));
    return f;
  }, [query, category, favOnly, favorites]);

  return (
    <div>
      {/* Lessons / Updates segment — combines the old Learn + What's New tabs. */}
      <div className="flex gap-1 mb-4 bg-bg3 border border-line rounded-lg p-1 w-fit">
        {(['lessons', 'updates'] as Segment[]).map(s => (
          <button key={s} onClick={() => setSegment(s)} aria-pressed={segment === s}
            className={`px-3.5 py-1.5 rounded-md text-[0.78rem] font-medium capitalize transition-colors ${segment === s ? 'bg-bg2 text-ink shadow-sm' : 'text-ink-mid hover:text-ink'}`}>
            {s === 'lessons' ? 'Lessons' : 'Updates'}
          </button>
        ))}
      </div>

      {segment === 'updates' ? <WhatsNew /> : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
              <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search lessons"
                placeholder="Search lessons — saving, EMI, SIP, runway…" className="input w-full pl-9" />
            </div>
            {cards.length > 0 && (
              <button onClick={() => setReelAt(0)} className="btn-secondary inline-flex items-center gap-1.5 flex-shrink-0">
                <PlaySquare size={15} /> Shorts
              </button>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap mb-4">
            <Chip active={category === 'all'} onClick={() => setCategory('all')}>All</Chip>
            {EVERGREEN_CATEGORIES.map(c => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Chip>)}
            <Chip active={favOnly} onClick={() => setFavOnly(v => !v)}><Heart size={11} className={favOnly ? 'fill-current' : ''} /> Saved</Chip>
          </div>

          {cards.length === 0 ? (
            <EmptyState icon="🔍" message={favOnly ? 'No saved lessons yet — tap ♡ on a card.' : `No lessons match "${query}"`} />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cards.map(c => (
                <article key={c.id} className="bg-bg border border-line rounded-xl p-3 flex flex-col hover:shadow-md transition-shadow">
                  <button onClick={() => setReading(c)} className="text-left" aria-label={`Read: ${c.title}`}>
                    <CardVisual card={c} className="h-28 mb-3" />
                    <span className="font-mono text-[0.55rem] tracking-wider uppercase text-ink-dim">{c.category}</span>
                    <h3 className="font-semibold text-ink text-[0.92rem] leading-snug mt-0.5 mb-2">{c.title}</h3>
                  </button>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="font-mono text-[0.62rem] text-ink-dim"><Clock size={10} className="inline mr-1" />{readingChip(c.reading_seconds)}</span>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => shareEvergreen(c.id, c.title)} aria-label="Share"
                        className="p-1.5 rounded-md text-ink-dim hover:text-coral hover:bg-coral-tint transition-colors"><Share2 size={13} /></button>
                      <button onClick={() => toggleFav(c.id)} aria-label={favorites.has(c.id) ? 'Unsave' : 'Save'}
                        className={`p-1.5 rounded-md transition-colors ${favorites.has(c.id) ? 'text-coral bg-coral-tint' : 'text-ink-dim hover:text-coral hover:bg-coral-tint'}`}>
                        <Heart size={13} className={favorites.has(c.id) ? 'fill-current' : ''} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {reading && (
        <EvergreenReader card={reading} isFav={favorites.has(reading.id)} onToggleFav={() => toggleFav(reading.id)} onClose={() => setReading(null)} />
      )}
      {reelAt !== null && cards.length > 0 && (
        <EvergreenReel cards={cards} startIndex={reelAt} onClose={() => setReelAt(null)} favorites={favorites} onToggleFav={toggleFav} />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1 font-mono text-[0.6rem] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-md border transition ${
        active ? 'bg-coral text-white border-coral' : 'bg-bg border-line text-ink-mid hover:border-line2 hover:text-ink'}`}>
      {children}
    </button>
  );
}
