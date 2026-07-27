// Aurora forms-doctrine container (v10.1).
// A SINGLE responsive glass panel — a bottom half-sheet on mobile, a compact
// centered dialog on desktop (≥sm) — so the form's children render exactly once
// (no duplicated inputs / ids across breakpoints). Dismiss via the grabber
// (mobile), the ✕ (desktop), a scrim tap, or Esc. Wraps existing form save
// logic; it does NOT replace the store modal-slot pattern (pages still call
// openAdd/close via the slice).
import { type ReactNode, useEffect, useId } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { scrim, sheetUp } from '../../lib/motion';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Accessible label when no visible title is rendered (amount-first sheets). */
  ariaLabel?: string;
  children: ReactNode;
  /** Optional sticky footer (primary action row) that never scrolls away. */
  footer?: ReactNode;
}

export default function HalfSheet({ open, onClose, title, ariaLabel, children, footer }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scrim"
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-5"
          style={{ background: 'rgba(5,10,12,0.55)', backdropFilter: 'blur(3px)' }}
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
          variants={scrim} initial="hidden" animate="visible" exit="exit"
        >
          <motion.div
            role="dialog" aria-modal="true"
            aria-label={ariaLabel} aria-labelledby={title ? titleId : undefined}
            className="w-full sm:max-w-md glass-panel rounded-t-r4 sm:rounded-r4 max-h-[92dvh] sm:max-h-[90vh] flex flex-col"
            variants={sheetUp} initial="hidden" animate="visible" exit="exit"
          >
            {/* Mobile grabber (doubles as a close affordance) */}
            <button onClick={onClose} aria-label="Close"
              className="sm:hidden w-11 h-[5px] rounded-full bg-ink-dim/55 mx-auto mt-2.5 mb-1 flex-shrink-0 border-none cursor-pointer p-0" />
            {title && (
              <div className="flex items-center justify-between px-5 pt-1 sm:pt-4 pb-3 sm:border-b sm:border-line flex-shrink-0">
                <h3 id={titleId} className="display-italic text-[1.4rem] leading-none text-ink">{title}</h3>
                <button onClick={onClose} aria-label="Close" className="hidden sm:block text-ink-dim hover:text-ink transition-colors p-1"><X size={18} /></button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-5 pb-4 sm:py-4">{children}</div>
            {footer && <div className="px-5 pt-2 pb-[max(16px,env(safe-area-inset-bottom))] sm:py-3 border-t border-line flex-shrink-0">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
