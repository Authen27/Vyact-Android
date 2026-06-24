// v7.3 — Money Map Item #7 prep / SOLUTION_EDUCATION.md (Variant C).
//
// Minimal contextual-help chip. Click `(?)` → small popover with a 2-3
// sentence explainer and an optional link. Marks the topic as `seen`
// (completed_at) on first open and as `dismissed_at` on the X button so
// the next session can hide it if the caller wants. Caller controls
// rendering via `educationProgress` from the store; this component is
// presentation-only beyond firing the store action.

import { useEffect, useRef, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { useStore } from '../../store';

export interface WhyChipProps {
  topicId: string;
  title: string;
  body: string;
  helpHref?: string;
  /** When true, the chip becomes a no-op render after dismissal. Defaults
   *  to false — we keep the chip available since users may want to revisit. */
  hideAfterDismiss?: boolean;
}

export function WhyChip({ topicId, title, body, helpHref, hideAfterDismiss = false }: WhyChipProps) {
  const progress = useStore(s => s.profile.educationProgress);
  const markEducation = useStore(s => s.markEducation);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dismissed = Boolean(progress?.[topicId]?.dismissed_at);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (hideAfterDismiss && dismissed) return null;

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={`Why: ${title}`}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !progress?.[topicId]?.completed_at) {
            void markEducation(topicId, { completed_at: new Date().toISOString() });
          }
        }}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={title}
          className="absolute left-5 top-0 z-50 w-64 rounded-md border border-border bg-card shadow-lg p-3 text-sm"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="font-medium text-foreground">{title}</h4>
            <button
              type="button"
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                void markEducation(topicId, {
                  completed_at: progress?.[topicId]?.completed_at ?? new Date().toISOString(),
                  dismissed_at: new Date().toISOString(),
                });
                setOpen(false);
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-muted-foreground leading-relaxed">{body}</p>
          {helpHref && (
            <a
              href={helpHref}
              className="inline-block mt-2 text-xs text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              Learn more →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default WhyChip;
