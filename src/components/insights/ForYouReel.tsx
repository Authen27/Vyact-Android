// Vyact — "For You" full-screen reel (Insights Hub §3, v9.5.3).
//
// The personal-insight feed presented as a reel: one insight per full-screen
// panel, vertical scroll-snap (swipe up/down on mobile, arrow keys on desktop),
// a progress rail, and an always-present Cancel (✕) to exit. Finite by design
// (3–5 cards, then an end panel) — anti-doomscroll, per the strategy brief.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowRight, BookOpen, ChevronUp, Share2 } from 'lucide-react';
import type { FeedCard } from '../../lib/insightsFeed';
import { shareEvergreen, shareApp } from '../../lib/share';

interface Props {
  cards: FeedCard[];
  startIndex?: number;
  onClose: () => void;
  /** Open an evergreen lesson by id (nudge_to_learn cards). */
  onOpenLearn: (id: string) => void;
}

const toneBg: Record<FeedCard['tone'], string> = {
  neutral: 'from-denim/20 via-bg to-bg',
  positive: 'from-sage/25 via-bg to-bg',
  constructive: 'from-honey/20 via-bg to-bg',
};

export default function ForYouReel({ cards, startIndex = 0, onClose, onOpenLearn }: Props) {
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(startIndex);

  // Lock body scroll while the reel owns the screen; restore on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Jump to the requested start panel once mounted.
  useEffect(() => {
    const el = scroller.current?.children[startIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc cancels; arrows move between panels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = active + (e.key === 'ArrowDown' ? 1 : -1);
        const el = scroller.current?.children[next] as HTMLElement | undefined;
        el?.scrollIntoView({ behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);

  // Track which panel is centred for the progress rail.
  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    setActive(Math.round(el.scrollTop / el.clientHeight));
  }

  const total = cards.length + 1; // +1 for the end panel

  return (
    <div className="fixed inset-0 z-[200] bg-bg" role="dialog" aria-label="Your insights" aria-modal="true">
      {/* Cancel — always reachable */}
      <button
        onClick={onClose}
        aria-label="Close insights"
        className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-ink/10 hover:bg-ink/20 text-ink flex items-center justify-center backdrop-blur-sm"
      >
        <X size={20} />
      </button>

      {/* Progress rail */}
      <div className="absolute top-5 left-4 z-20 flex flex-col gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`w-1 rounded-full transition-all ${i === active ? 'h-5 bg-coral' : 'h-2 bg-ink/20'}`} />
        ))}
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="h-full overflow-y-auto snap-y snap-mandatory scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        {cards.map((c, i) => (
          <section key={c.id} className={`h-full w-full snap-start flex flex-col items-center justify-center px-7 text-center bg-gradient-to-b ${toneBg[c.tone]}`}>
            <div className="text-5xl mb-5" aria-hidden>{c.emoji}</div>
            <div className="num text-[2.4rem] leading-tight font-semibold text-ink max-w-md">{c.big}</div>
            <p className="text-[1rem] text-ink-mid mt-4 max-w-sm leading-relaxed">{c.line}</p>

            <div className="flex items-center gap-2.5 mt-7">
              {(c.to || c.learnId) && (
                <button
                  onClick={() => { if (c.learnId) onOpenLearn(c.learnId); else if (c.to) { onClose(); navigate(c.to); } }}
                  className="btn-primary inline-flex items-center gap-1.5"
                >
                  {c.learnId ? <><BookOpen size={15} /> Read the idea</> : <>See the detail <ArrowRight size={15} /></>}
                </button>
              )}
              {/* Share — a lesson card shares its public page; a private insight
                  promotes the app with NO personal numbers (privacy). */}
              <button
                onClick={() => { if (c.learnId) shareEvergreen(c.learnId, c.big); else shareApp(); }}
                aria-label="Share"
                className="w-11 h-11 rounded-full border border-line bg-bg2 text-ink-mid hover:text-coral hover:border-coral/40 flex items-center justify-center"
              >
                <Share2 size={17} />
              </button>
            </div>

            {i === 0 && cards.length > 1 && (
              <div className="absolute bottom-7 flex flex-col items-center text-ink-dim animate-bounce">
                <ChevronUp size={18} className="rotate-180" />
                <span className="font-mono text-[0.56rem] tracking-widest uppercase">Swipe up</span>
              </div>
            )}
          </section>
        ))}

        {/* End panel — finite, no infinite scroll */}
        <section className="h-full w-full snap-start flex flex-col items-center justify-center px-7 text-center">
          <div className="text-4xl mb-4" aria-hidden>✨</div>
          <div className="display-italic text-2xl text-ink mb-2">That's your read for now</div>
          <p className="text-[0.9rem] text-ink-mid max-w-xs mb-6">A short, finite look — not an endless scroll. Come back tomorrow for fresh insights.</p>
          <button onClick={onClose} className="btn-secondary">Done</button>
        </section>
      </div>
    </div>
  );
}
