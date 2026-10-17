// The Dashboard's "Learn in a minute" shelf (owner, 16 Oct 2026). Loaded lazily by the Dashboard, so the
// lesson library (a large JSON) never delays the first paint. Each card opens the lesson in place, in
// the same reader Learn uses; "Explore lessons" goes to the whole library.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Clock, ArrowRight } from 'lucide-react';
import EvergreenReel from '../insights/EvergreenReel';
import { readingChip } from '../../lib/evergreen';
import { dashboardLessons, lessonPreview, type LearnSituation } from '../../lib/learnPicks';

export default function LearnShelf({ situation, todayISO }: { situation: LearnSituation; todayISO: string }) {
  const picks = useMemo(() => dashboardLessons(situation, todayISO, 3), [situation, todayISO]);
  const [open, setOpen] = useState<number | null>(null);
  if (!picks.length) return null;
  return (
    <section aria-labelledby="dashboard-learn-title" data-testid="dashboard-learn">
      <div className="flex items-baseline justify-between gap-3 mb-2.5 px-0.5">
        <h2 id="dashboard-learn-title" className="text-[15px] font-semibold text-ink">Learn in a minute</h2>
        <Link to="/insights?tab=learn" className="inline-flex items-center gap-1 text-[13px] font-medium text-coral hover:opacity-70 min-h-[44px]">
          Explore lessons <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {picks.map((p, i) => (
          <button key={p.card.id} type="button" onClick={() => setOpen(i)} data-testid="dashboard-lesson"
            aria-label={`Read: ${p.card.title}`}
            className="tile !rounded-r3 p-4 text-left flex flex-col min-w-0 hover:brightness-105 transition-[filter]">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-coral">
              <BookOpen size={13} aria-hidden /> {p.card.category}
            </span>
            <span className="block font-semibold text-[0.95rem] text-ink leading-snug mt-1.5">{p.card.title}</span>
            <span className="block text-[12.5px] text-ink-mid leading-relaxed mt-1.5 line-clamp-3">{lessonPreview(p.card.body_md)}</span>
            <span className="mt-auto pt-3 flex items-center justify-between gap-2 text-[12px] text-ink-dim">
              <span className="truncate">{p.reason}</span>
              <span className="flex items-center gap-1 flex-shrink-0"><Clock size={11} aria-hidden />{readingChip(p.card.reading_seconds)}</span>
            </span>
          </button>
        ))}
      </div>
      {open !== null && (
        <EvergreenReel cards={picks.map(p => p.card)} startIndex={open} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}
