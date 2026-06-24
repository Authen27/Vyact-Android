// Vyact — evergreen lesson reader (shared by the Learn grid + the shorts reel).
// Renders the code-drawn visual, the full body, a Save (favorite) and a Share
// action (public /learn/<slug> link), and injects client-side JSON-LD for SEO.
import { useEffect } from 'react';
import { Heart, X, Share2 } from 'lucide-react';
import CardVisual from './CardVisual';
import { readingChip, type EvergreenCard } from '../../lib/evergreen';
import { shareEvergreen, evergreenUrl, setJsonLd, PUBLIC_BASE } from '../../lib/share';

export function lessonJsonLd(card: EvergreenCard) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: card.title,
    articleSection: card.category,
    keywords: card.tags.join(', '),
    inLanguage: 'en',
    isAccessibleForFree: true,
    timeRequired: `PT${card.reading_seconds}S`,
    author: { '@type': 'Organization', name: 'Vyact' },
    publisher: {
      '@type': 'Organization', name: 'Vyact',
      logo: { '@type': 'ImageObject', url: `${PUBLIC_BASE}/og-vyact.png` },
    },
    mainEntityOfPage: evergreenUrl(card.id),
    articleBody: card.body_md,
  };
}

export default function EvergreenReader({ card, isFav, onToggleFav, onClose, onShared }: {
  card: EvergreenCard;
  isFav: boolean;
  onToggleFav: () => void;
  onClose: () => void;
  onShared?: (result: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    setJsonLd(card.id, lessonJsonLd(card));
    return () => { window.removeEventListener('keydown', onKey); setJsonLd(card.id, null); };
  }, [onClose, card]);

  const paragraphs = card.body_md.split(/\n\n+/);

  async function share() {
    const r = await shareEvergreen(card.id, card.title);
    onShared?.(r);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      style={{ background: 'hsl(var(--shadow) / 0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-bg2 border border-line2 rounded-lg w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-3">
        <div className="px-5 pt-5">
          <CardVisual card={card} className="h-36" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            <span className="font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim">{card.category} · {readingChip(card.reading_seconds)}</span>
            <h2 className="display-italic text-2xl text-ink leading-tight mt-0.5">{card.title}</h2>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={share} aria-label="Share" className="p-2 rounded-md text-ink-dim hover:text-coral hover:bg-coral-tint transition-colors"><Share2 size={16} /></button>
            <button onClick={onToggleFav} aria-label={isFav ? 'Unsave' : 'Save'}
              className={`p-2 rounded-md transition-colors ${isFav ? 'text-coral bg-coral-tint' : 'text-ink-dim hover:text-coral hover:bg-coral-tint'}`}>
              <Heart size={16} className={isFav ? 'fill-current' : ''} />
            </button>
            <button onClick={onClose} className="text-ink-dim hover:text-ink p-1.5" aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          {paragraphs.map((p, i) => <p key={i} className="text-[0.92rem] text-ink leading-relaxed">{p}</p>)}
        </div>
      </div>
    </div>
  );
}
