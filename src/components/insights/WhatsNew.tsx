// Vyact — "What's New" tab (Insights Hub §7, v9.5.3).
// Curated editorial / external content from public.content_items (the existing
// v6.3 content module), newest first. The admin-side source-allowlist curation
// UI (RBI/SEBI/etc. with a "why it matters" line) is the deferred follow-up; this
// renders whatever the content module already publishes, reverse-chronological.
import { useEffect, useMemo, useState } from 'react';
import { Search, Heart, BookOpen, Clock, X } from 'lucide-react';
import { useStore } from '../../store';
import { Panel } from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import { isCloudEnabled } from '../../lib/supabase';
import {
  listPublishedContent, listFavoriteIds, addFavorite, removeFavorite,
  type InsightArticle,
} from '../../lib/insightsApi';

const TOPIC_COLOR: Record<InsightArticle['topic'], string> = {
  debt: 'text-terra bg-terra/10', tax: 'text-denim bg-denim/10',
  investment: 'text-honey bg-honey/15', budgeting: 'text-coral bg-coral-tint',
  savings: 'text-sage bg-sage/10', retirement: 'text-plum bg-plum/10',
};

export default function WhatsNew() {
  const session = useStore(s => s.session);
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const toast = useStore(s => s.toast);

  const [articles, setArticles] = useState<InsightArticle[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState<InsightArticle | null>(null);

  useEffect(() => {
    if (!isCloudEnabled() || !session) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const [a, fav] = await Promise.all([listPublishedContent(), listFavoriteIds()]);
        if (cancelled) return;
        setArticles(a); setFavorites(fav);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const filtered = useMemo(() => {
    if (!query.trim()) return articles;
    const q = query.toLowerCase();
    return articles.filter(a =>
      a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q) ||
      a.body.toLowerCase().includes(q) || a.topic.toLowerCase().includes(q));
  }, [articles, query]);

  async function toggleFav(a: InsightArticle) {
    const isFav = favorites.has(a.id);
    setFavorites(prev => { const n = new Set(prev); if (isFav) n.delete(a.id); else n.add(a.id); return n; });
    try { if (isFav) await removeFavorite(a.id); else await addFavorite(a.id); }
    catch (e) {
      setFavorites(prev => { const n = new Set(prev); if (isFav) n.add(a.id); else n.delete(a.id); return n; });
      toast(`Could not update favorite: ${(e as Error).message}`, 'error');
    }
  }

  if (!cloudEnabled) {
    return (
      <Panel>
        <div className="px-6 py-14 text-center">
          <div className="text-4xl mb-3 opacity-60">📰</div>
          <p className="text-ink-mid mb-2">What's New requires cloud sync.</p>
          <p className="text-[0.84rem] text-ink-dim">Sign in with a cloud-enabled deployment to read curated updates.</p>
        </div>
      </Panel>
    );
  }

  return (
    <div>
      <div className="relative flex-1 min-w-[220px] mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search updates…" aria-label="Search updates" className="input w-full pl-9" />
      </div>

      {loading && <Panel><div className="px-6 py-10 text-center text-ink-mid text-sm">Loading…</div></Panel>}
      {error && <Panel><div className="px-6 py-6 text-center text-terra text-sm">Could not load: {error}</div></Panel>}
      {!loading && !error && filtered.length === 0 && (
        <EmptyState icon="🗞️" message={query ? `No updates match "${query}"` : 'No updates published yet — check back soon.'} />
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(a => {
          const isFav = favorites.has(a.id);
          return (
            <article key={a.id} className="bg-bg border border-line rounded-xl p-5 transition-shadow hover:shadow-md flex flex-col">
              <div className="flex items-start justify-between mb-2">
                <span className="text-2xl" aria-hidden>{a.coverEmoji}</span>
                <button onClick={() => toggleFav(a)} aria-label={isFav ? 'Unfavorite' : 'Favorite'}
                  className={`p-1.5 rounded-md transition-colors ${isFav ? 'text-coral bg-coral-tint' : 'text-ink-dim hover:text-coral hover:bg-coral-tint'}`}>
                  <Heart size={14} className={isFav ? 'fill-current' : ''} />
                </button>
              </div>
              <span className={`inline-block self-start font-mono text-[0.55rem] tracking-wider uppercase px-2 py-0.5 rounded-full mb-2 ${TOPIC_COLOR[a.topic]}`}>{a.topic}</span>
              <h3 className="font-semibold text-ink text-[0.94rem] leading-snug mb-1.5">{a.title}</h3>
              <p className="text-[0.82rem] text-ink-mid leading-relaxed flex-1 mb-3">{a.summary}</p>
              <div className="flex items-center justify-between text-[0.72rem] text-ink-dim font-mono">
                <span><Clock size={10} className="inline mr-1" />{a.readMinutes} min</span>
                <button onClick={() => setReading(a)} className="text-coral hover:underline tracking-wider uppercase text-[0.62rem]">
                  <BookOpen size={10} className="inline mr-1" /> Read →
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {reading && <Reader article={reading} isFav={favorites.has(reading.id)} onToggleFav={() => toggleFav(reading)} onClose={() => setReading(null)} />}
    </div>
  );
}

function Reader({ article, isFav, onToggleFav, onClose }: {
  article: InsightArticle; isFav: boolean; onToggleFav: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-5"
      style={{ background: 'hsl(var(--shadow) / 0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-bg2 border border-line2 rounded-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-3">
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-line">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-3xl flex-shrink-0">{article.coverEmoji}</span>
            <div className="min-w-0">
              <h2 className="display-italic text-2xl text-ink leading-tight mb-1">{article.title}</h2>
              <div className="font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim">{article.topic} · {article.readMinutes} min · {article.authorName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onToggleFav} aria-label={isFav ? 'Unfavorite' : 'Favorite'}
              className={`p-2 rounded-md transition-colors ${isFav ? 'text-coral bg-coral-tint' : 'text-ink-dim hover:text-coral hover:bg-coral-tint'}`}>
              <Heart size={16} className={isFav ? 'fill-current' : ''} />
            </button>
            <button onClick={onClose} className="text-ink-dim hover:text-ink p-1" aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="px-6 py-5">
          {article.summary && <p className="text-[0.95rem] text-ink-mid italic mb-4 leading-relaxed border-l-2 border-coral pl-3">{article.summary}</p>}
          <div className="text-[0.92rem] text-ink leading-relaxed whitespace-pre-line">{article.body}</div>
        </div>
      </div>
    </div>
  );
}
