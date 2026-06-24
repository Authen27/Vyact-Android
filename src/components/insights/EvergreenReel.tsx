// Vyact — Learn "shorts" reel (Insights Hub v9.5.5).
// The evergreen library as a finite, vertically-scrollable reel: one lesson per
// full-screen panel (visual + title + teaser), with Save + Share on every short
// and a tap to read the full lesson. Mirrors the For You reel's mechanics.
import { useEffect, useRef, useState } from 'react';
import { X, Share2, Heart, BookOpen, ChevronUp } from 'lucide-react';
import CardVisual from './CardVisual';
import EvergreenReader from './EvergreenReader';
import { readingChip, type EvergreenCard } from '../../lib/evergreen';
import { shareEvergreen } from '../../lib/share';

interface Props {
  cards: EvergreenCard[];
  startIndex?: number;
  onClose: () => void;
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
}

function teaser(body: string): string {
  const first = body.split(/\n\n+/)[0] || body;
  return first.length > 240 ? first.slice(0, 237).trimEnd() + '…' : first;
}

export default function EvergreenReel({ cards, startIndex = 0, onClose, favorites, onToggleFav }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(startIndex);
  const [reading, setReading] = useState<EvergreenCard | null>(null);

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
      if (reading) return; // reader owns Esc while open
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = active + (e.key === 'ArrowDown' ? 1 : -1);
        (scroller.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose, reading]);

  function onScroll() {
    const el = scroller.current;
    if (el) setActive(Math.round(el.scrollTop / el.clientHeight));
  }

  const total = cards.length + 1;

  return (
    <div className="fixed inset-0 z-[190] bg-bg" role="dialog" aria-label="Learn shorts" aria-modal="true">
      <button onClick={onClose} aria-label="Close shorts"
        className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-ink/10 hover:bg-ink/20 text-ink flex items-center justify-center backdrop-blur-sm">
        <X size={20} />
      </button>
      <div className="absolute top-5 left-4 z-20 flex flex-col gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`w-1 rounded-full transition-all ${i === active ? 'h-5 bg-coral' : 'h-2 bg-ink/20'}`} />
        ))}
      </div>

      <div ref={scroller} onScroll={onScroll}
        className="h-full overflow-y-auto snap-y snap-mandatory scroll-smooth" style={{ scrollbarWidth: 'none' }}>
        {cards.map((c, i) => (
          <section key={c.id} className="h-full w-full snap-start flex flex-col items-center justify-center px-7 text-center bg-gradient-to-b from-coral/10 via-bg to-bg">
            <CardVisual card={c} className="h-40 w-full max-w-sm mb-5" />
            <span className="font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim">{c.category} · {readingChip(c.reading_seconds)}</span>
            <h2 className="display-italic text-[2rem] leading-tight text-ink max-w-md mt-1">{c.title}</h2>
            <p className="text-[0.95rem] text-ink-mid mt-3 max-w-sm leading-relaxed">{teaser(c.body_md)}</p>

            <div className="flex items-center gap-2.5 mt-6">
              <button onClick={() => setReading(c)} className="btn-primary inline-flex items-center gap-1.5"><BookOpen size={15} /> Read</button>
              <button onClick={() => shareEvergreen(c.id, c.title)} aria-label="Share" className="w-11 h-11 rounded-full border border-line bg-bg2 text-ink-mid hover:text-coral hover:border-coral/40 flex items-center justify-center"><Share2 size={17} /></button>
              <button onClick={() => onToggleFav(c.id)} aria-label={favorites.has(c.id) ? 'Unsave' : 'Save'}
                className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${favorites.has(c.id) ? 'text-coral bg-coral-tint border-coral/40' : 'border-line bg-bg2 text-ink-mid hover:text-coral hover:border-coral/40'}`}>
                <Heart size={17} className={favorites.has(c.id) ? 'fill-current' : ''} />
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

        <section className="h-full w-full snap-start flex flex-col items-center justify-center px-7 text-center">
          <div className="text-4xl mb-4" aria-hidden>✨</div>
          <div className="display-italic text-2xl text-ink mb-2">That's the set</div>
          <p className="text-[0.9rem] text-ink-mid max-w-xs mb-6">A finite stack of money ideas — search the library for more.</p>
          <button onClick={onClose} className="btn-secondary">Done</button>
        </section>
      </div>

      {reading && (
        <EvergreenReader card={reading} isFav={favorites.has(reading.id)} onToggleFav={() => onToggleFav(reading.id)} onClose={() => setReading(null)} />
      )}
    </div>
  );
}
