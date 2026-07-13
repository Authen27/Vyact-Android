// Aurora top pull-down sheet (v10.1) — the shared gesture for the notification
// centre and the household switcher. A glass panel drawn from the top edge,
// full-width on mobile, a centered 720px column on desktop. Dismiss via
// swipe-up, scrim tap, Esc, or the grabber.
import { type ReactNode, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { scrim, sheetDown } from '../../lib/motion';

interface Props {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  /** Sticky header inside the sheet (title row + actions). */
  header?: ReactNode;
  /** Sticky footer (e.g. settings link) above the grabber. */
  footer?: ReactNode;
  children: ReactNode;
}

export default function PullDownSheet({ open, onClose, ariaLabel, header, footer, children }: Props) {
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
          className="fixed inset-0 z-[200] flex justify-center"
          style={{ background: 'rgba(5,10,12,0.55)', backdropFilter: 'blur(3px)' }}
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
          variants={scrim} initial="hidden" animate="visible" exit="exit"
        >
          <motion.div
            role="dialog" aria-modal="true" aria-label={ariaLabel}
            className="glass-panel w-full sm:max-w-[720px] max-h-[92dvh] flex flex-col rounded-b-r4"
            style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
            variants={sheetDown} initial="hidden" animate="visible" exit="exit"
          >
            {header && <div className="px-5 sm:px-6 pt-[max(14px,env(safe-area-inset-top))] flex-shrink-0">{header}</div>}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-2">{children}</div>
            {footer && <div className="px-5 sm:px-6 py-2 border-t border-line flex-shrink-0">{footer}</div>}
            <button onClick={onClose} aria-label="Close" className="w-11 h-[5px] rounded-full bg-ink-dim/55 mx-auto mb-2 mt-1 flex-shrink-0 border-none cursor-pointer p-0" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
