// Vyact — the universal Insight card/article detail surface (v9.9.2).
// A flip card: front face is the infographic (fully visible, never cropped —
// `object-contain`, not `object-cover`) or the code-rendered fallback visual
// when no infographic exists; a title/scrim overlay auto-hides after 4s and
// toggles back on tap. Two minimal controls — Play / Text — flip the card to
// a back face showing the autoplaying video or the article body. A single
// back control flips to the front again. Share/Save intentionally live only
// on the grid tile (EvergreenLearn/WhatsNew) — not duplicated here.
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PlayCircle, BookOpen, RotateCcw, ExternalLink } from 'lucide-react';
import { spring } from '../../lib/motion';
import { youtubeEmbedUrl, youtubeWatchUrl } from '../../lib/youtube';

const TITLE_AUTO_HIDE_MS = 4000;

interface Props {
  infographicUrl?: string | null;
  fallbackVisual: React.ReactNode;
  title: string;
  meta: string;
  teaser?: string;
  videoUrl?: string | null;
  articleBody: React.ReactNode;
}

type Side = 'front' | 'video' | 'text';

export default function FlippableCardDetail({ infographicUrl, fallbackVisual, title, meta, teaser, videoUrl, articleBody }: Props) {
  const [side, setSide] = useState<Side>('front');
  const [titleVisible, setTitleVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  function armAutoHide() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setTitleVisible(false), TITLE_AUTO_HIDE_MS);
  }

  useEffect(() => {
    if (!infographicUrl) return;
    armAutoHide();
    return () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); };
  }, [infographicUrl]);

  function toggleTitle() {
    setTitleVisible(v => {
      const next = !v;
      if (next) armAutoHide();
      return next;
    });
  }

  const embed = videoUrl ? youtubeEmbedUrl(videoUrl) : null;
  const watch = videoUrl ? youtubeWatchUrl(videoUrl) : null;

  return (
    <div className="h-full w-full" style={{ perspective: 1200 }}>
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateY: side === 'front' ? 0 : 180 }}
        transition={spring}
      >
        {/* Front face — infographic or fallback visual */}
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          {infographicUrl ? (
            <div className="relative h-full w-full bg-bg2" onClick={toggleTitle}>
              <img src={infographicUrl} alt={title} className="absolute inset-0 w-full h-full object-contain" />
              <div
                className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/30 to-transparent px-5 pt-6 pb-10 transition-opacity duration-500"
                style={{ opacity: titleVisible ? 1 : 0 }}
              >
                <span className="font-mono text-[0.58rem] tracking-wider uppercase text-white/70">{meta}</span>
                <h2 className="display-italic text-xl leading-tight text-white mt-1">{title}</h2>
              </div>
            </div>
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center px-7 text-center bg-gradient-to-b from-coral/10 via-bg to-bg">
              {fallbackVisual}
              <span className="font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim mt-4">{meta}</span>
              <h2 className="display-italic text-[1.8rem] leading-tight text-ink max-w-md mt-1">{title}</h2>
              {teaser && <p className="text-[0.95rem] text-ink-mid mt-3 max-w-sm leading-relaxed">{teaser}</p>}
            </div>
          )}

          {/* Minimal controls — always reachable, independent of the auto-hiding title. */}
          <div className="absolute bottom-6 inset-x-0 flex items-center justify-center gap-3" onClick={e => e.stopPropagation()}>
            {embed && (
              <button onClick={() => setSide('video')} className="btn-primary inline-flex items-center gap-1.5">
                <PlayCircle size={16} /> Play
              </button>
            )}
            {/* Solid theme surface, not a white-ghost chip: with object-contain
                letterboxing the backdrop can be light OR dark, so the button
                must be readable on both. */}
            <button onClick={() => setSide('text')} className="btn-secondary inline-flex items-center gap-1.5 shadow-2">
              <BookOpen size={15} /> Text
            </button>
          </div>
        </div>

        {/* Back face — video or text, whichever was chosen. */}
        <div className="absolute inset-0 bg-bg" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <button onClick={() => setSide('front')} aria-label="Back to infographic"
            className="absolute top-4 left-4 z-10 w-10 h-10 rounded-full bg-ink/10 hover:bg-ink/20 text-ink flex items-center justify-center backdrop-blur-sm">
            <RotateCcw size={18} />
          </button>

          {side === 'video' && embed && (
            <div className="h-full w-full flex flex-col bg-black">
              <div className="flex-1 relative">
                <iframe
                  src={side === 'video' ? `${embed}&autoplay=1&playsinline=1` : undefined}
                  title={`${title} — video`}
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              {watch && (
                <a href={watch} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 py-3 text-[0.8rem] font-medium text-white/80 hover:text-white">
                  <ExternalLink size={14} /> Open in YouTube
                </a>
              )}
            </div>
          )}

          {side === 'text' && (
            <div className="h-full w-full overflow-y-auto px-6 pt-16 pb-10">
              <span className="font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim">{meta}</span>
              <h2 className="display-italic text-2xl leading-tight text-ink mt-1 mb-4">{title}</h2>
              {articleBody}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
