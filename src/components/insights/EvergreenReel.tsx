// Vyact — the Learn tab's universal card viewer (v9.9.2).
// Every card opens here — a finite, vertically-swipeable, full-screen reel.
// Each slide is a flip card (FlippableCardDetail): front = infographic (fully
// visible, not cropped) or the code-visual fallback; back = video or text,
// chosen via two minimal controls. Share/Save live on the grid tile, not here.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronUp } from 'lucide-react';
import CardVisual from './CardVisual';
import FlippableCardDetail from './FlippableCardDetail';
import { readingChip, type EvergreenCard } from '../../lib/evergreen';

interface Props {
  cards: EvergreenCard[];
  startIndex?: number;
  onClose: () => void;
}

function paragraphs(body: string): string[] {
  return body.split(/\n\n+/);
}

export default function EvergreenReel({ cards, startIndex = 0, onClose }: Props) {
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

  // Portalled to <body> — `<main>` (Layout.tsx) sets its own z-index and thereby
  // establishes a stacking context, so a z-index on a MERE DESCENDANT (this reel)
  // can never outrank true siblings of <main> like MobileTabBar/AddFab/CommandPalette,
  // no matter how high. That trapped the reel's Play/Text controls under the tab
  // bar on mobile. Escaping to `document.body` sidesteps the trap entirely.
  return createPortal(
    <div className="fixed inset-0 z-[190] bg-bg" role="dialog" aria-label="Learn" aria-modal="true">
      <button onClick={onClose} aria-label="Close"
        className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-ink/10 hover:bg-ink/20 text-ink flex items-center justify-center backdrop-blur-sm">
        <X size={20} />
      </button>
      {/* Position counter — a compact pill, not one dot per card: with 116
          lessons a dot column overflows the viewport and collides with the
          flip-back control at the top-left of each card (v9.9.3). */}
      <div className="absolute top-5 inset-x-0 z-20 flex justify-center pointer-events-none">
        <span className="num font-mono text-[0.62rem] tracking-widest px-2.5 py-1 rounded-full bg-ink/10 text-ink backdrop-blur-sm">
          {Math.min(active + 1, cards.length)} / {cards.length}
        </span>
      </div>

      <div ref={scroller} onScroll={onScroll}
        className="h-full overflow-y-auto snap-y snap-mandatory scroll-smooth" style={{ scrollbarWidth: 'none' }}>
        {cards.map((c, i) => (
          <section key={c.id} className="h-full w-full snap-start relative overflow-hidden">
            <FlippableCardDetail
              infographicUrl={c.infographic_url}
              fallbackVisual={<CardVisual card={c} className="h-40 w-full max-w-sm mb-2" />}
              title={c.title}
              meta={`${c.category} · ${readingChip(c.reading_seconds)}`}
              teaser={paragraphs(c.body_md)[0]}
              videoUrl={c.video_url}
              articleBody={paragraphs(c.body_md).map((p, pi) => (
                <p key={pi} className="text-[0.92rem] text-ink leading-relaxed mb-3">{p}</p>
              ))}
            />

            {i === 0 && cards.length > 1 && (
              <div className={`absolute inset-x-0 flex flex-col items-center animate-bounce pointer-events-none ${c.infographic_url ? 'top-5 text-white/80' : 'bottom-7 text-ink-dim'}`}>
                <ChevronUp size={18} className="rotate-180" />
                <span className="font-mono text-[0.56rem] tracking-widest uppercase">Swipe up</span>
              </div>
            )}
          </section>
        ))}

        <section className="h-full w-full snap-start flex flex-col items-center justify-center px-7 text-center">
          <div className="text-4xl mb-4" aria-hidden>✨</div>
          <div className="display-italic text-2xl text-ink mb-2">That's the set</div>
          <p className="text-[0.9rem] text-ink-mid max-w-xs mb-6">A finite stack of money ideas — search the library for more.</p>
          <button onClick={onClose} className="btn-secondary">Done</button>
        </section>
      </div>
    </div>,
    document.body,
  );
}
