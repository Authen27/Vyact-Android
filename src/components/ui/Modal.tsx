import { type ReactNode, useEffect, useId } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { backdrop, dialogPanel } from '../../lib/motion';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ open, title, onClose, children }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // AnimatePresence keeps the dialog mounted through its EXIT animation when
  // `open` flips false — previously it just cut to nothing. The panel springs in
  // and eases out; the backdrop cross-fades.
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          className="fixed inset-0 z-[200] flex items-center justify-center p-5"
          style={{ background: 'hsl(var(--shadow) / 0.55)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {/* role/aria-modal/aria-labelledby give the overlay an accessible name
              (its title), so assistive tech — and Playwright's
              getByRole('dialog', { name }) — can target it unambiguously. */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-bg2 border border-line2 rounded-lg w-full max-w-md max-h-[92vh] overflow-y-auto shadow-3"
            variants={dialogPanel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="flex justify-between items-center px-5 py-4 border-b border-line">
              <h3 id={titleId} className="display-italic text-[1.5rem] leading-none text-ink">{title}</h3>
              <button onClick={onClose} className="text-ink-dim hover:text-ink transition-colors p-1">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
