// Vyact — the What's New tab's universal article viewer (v9.9.2).
// Mirrors EvergreenReel for the editorial/external content_items rows, using
// the same flip-card detail surface. Share/Save live on the grid tile, not here.
import { useEffect, useRef, useState } from 'react';
import { X, ChevronUp } from 'lucide-react';
import FlippableCardDetail from './FlippableCardDetail';
import type { InsightArticle } from '../../lib/insightsApi';

interface Props {
  articles: InsightArticle[];
  startIndex?: number;
  onClose: () => void;
}

export default function ArticleReel({ articles, startIndex = 0, onClose }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(startIndex);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    (scroller.current?.children[startIndex] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = active + (e.key === 'ArrowDown' ? 1 : -1);
        (scroller.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);

  function onScroll() {
    const el = scroller.current;
    if (el) setActive(Math.round(el.scrollTop / el.clientHeight));
  }

  return (
    <div className="fixed inset-0 z-[190] bg-bg" role="dialog" aria-label="What's New" aria-modal="true">
      <button onClick={onClose} aria-label="Close"
        className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-ink/10 hover:bg-ink/20 text-ink flex items-center justify-center backdrop-blur-sm">
        <X size={20} />
      </button>
      {/* Position counter — pill, not per-item dots (see EvergreenReel, v9.9.3). */}
      <div className="absolute top-5 inset-x-0 z-20 flex justify-center pointer-events-none">
        <span className="num font-mono text-[0.62rem] tracking-widest px-2.5 py-1 rounded-full bg-ink/10 text-ink backdrop-blur-sm">
          {Math.min(active + 1, articles.length)} / {articles.length}
        </span>
      </div>

      <div ref={scroller} onScroll={onScroll}
        className="h-full overflow-y-auto snap-y snap-mandatory scroll-smooth" style={{ scrollbarWidth: 'none' }}>
        {articles.map((a, i) => (
          <section key={a.id} className="h-full w-full snap-start relative overflow-hidden">
            <FlippableCardDetail
              infographicUrl={a.infographicUrl}
              fallbackVisual={<span className="text-5xl mb-2" aria-hidden>{a.coverEmoji}</span>}
              title={a.title}
              meta={`${a.topic} · ${a.readMinutes} min`}
              teaser={a.summary}
              videoUrl={a.videoUrl}
              articleBody={(
                <>
                  {a.summary && <p className="text-[0.95rem] text-ink-mid italic mb-4 leading-relaxed border-l-2 border-coral pl-3">{a.summary}</p>}
                  <p className="text-[0.92rem] text-ink leading-relaxed whitespace-pre-line">{a.body}</p>
                </>
              )}
            />

            {i === 0 && articles.length > 1 && (
              <div className={`absolute inset-x-0 flex flex-col items-center animate-bounce pointer-events-none ${a.infographicUrl ? 'top-5 text-white/80' : 'bottom-7 text-ink-dim'}`}>
                <ChevronUp size={18} className="rotate-180" />
                <span className="font-mono text-[0.56rem] tracking-widest uppercase">Swipe up</span>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
