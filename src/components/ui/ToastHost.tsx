import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useStore } from '../../store';
import { toast as toastVariant } from '../../lib/motion';
import { toastRole } from '../../lib/toastPolicy';
import { useLocation } from 'react-router-dom';
import { isFormRoute } from '../../lib/formRoutes';

// Aurora 4.0 TS1 — a toast you can read and tap: sentence-case 14px on a high-contrast bar (ink on
// the canvas colour, so it inverts per theme) that names the item, with a 44px Undo. Full width above
// the tab bar on phones; 380px bottom-right on desktop. It replaced 11px mono text in a 320px box with
// a coloured left edge and a 10.5px "UNDO".
const MARK = { success: '✓', error: '!', warning: '!', info: 'i' } as const;
const MARK_COLOUR = {
  success: 'var(--toast-good)', error: 'var(--toast-crit)', warning: 'var(--toast-warn)', info: 'var(--toast-info)',
} as const;

export default function ToastHost() {
  const toasts = useStore(s => s.toasts);
  const dismissToast = useStore(s => s.dismissToast);
  // A full-screen form has no tab bar and its Save/Add button sits in the bottom footer, where the
  // toast would cover it for up to 10 s; there the toast shows under the form header (.toast-on-form).
  const onForm = isFormRoute(useLocation().pathname);
  // Container stays mounted (even empty) so AnimatePresence can play the EXIT of
  // the last toast. `layout` lets the remaining toasts slide up to fill the gap.
  // W6 (audit FE-UIS-08): it is also a live region that exists before any toast arrives, so screen
  // readers announce each one; a failure is role="alert" (assertive), the rest role="status".
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Notifications"
      className={`fixed bottom-above-tabbar left-4 right-4 sm:left-auto sm:right-6 sm:w-[380px] z-[999] flex flex-col gap-2 pointer-events-none${onForm ? ' toast-on-form' : ''}`}
    >
      <AnimatePresence initial={false}>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            layout
            role={toastRole(t.type)}
            variants={toastVariant}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="pointer-events-auto flex items-center gap-3 min-h-[52px] pl-4 pr-1.5 py-1.5 rounded-r2 font-ui text-[14px] leading-snug"
            style={{ background: 'var(--toast-bg)', color: 'var(--toast-ink)', boxShadow: 'var(--toast-shadow)' }}
          >
            <span aria-hidden className="flex-shrink-0 font-semibold" style={{ color: MARK_COLOUR[t.type] }}>{MARK[t.type]}</span>
            <span className="flex-1 min-w-0 py-1.5">{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => { t.action!.run(); dismissToast(t.id); }}
                className="flex-shrink-0 min-h-[44px] px-2.5 font-bold text-[14px] hover:underline"
                style={{ color: 'var(--toast-action)' }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="flex-shrink-0 inline-flex items-center justify-center w-9 min-h-[44px] rounded-r2 opacity-70 hover:opacity-100"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
