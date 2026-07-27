import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../../store';
import { toast as toastVariant } from '../../lib/motion';

export default function ToastHost() {
  const toasts = useStore(s => s.toasts);
  const dismissToast = useStore(s => s.dismissToast);
  // Container stays mounted (even empty) so AnimatePresence can play the EXIT of
  // the last toast. `layout` lets the remaining toasts slide up to fill the gap.
  return (
    <div className="fixed bottom-5 right-5 z-[999] flex flex-col gap-2 max-w-xs pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map(t => {
          const accent = t.type === 'success' ? 'border-l-sage'
                       : t.type === 'error'   ? 'border-l-terra'
                       : t.type === 'warning' ? 'border-l-honey'
                       :                         'border-l-denim';
          return (
            <motion.div
              key={t.id}
              layout
              variants={toastVariant}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={`pointer-events-auto bg-bg2 border border-line2 ${accent} border-l-[3px] text-ink px-4 py-3 rounded-md font-mono text-[0.7rem] tracking-wide shadow-2 flex items-center gap-3`}
            >
              <span className="flex-1">{t.text}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => { t.action!.run(); dismissToast(t.id); }}
                  className="flex-shrink-0 font-mono text-[0.66rem] tracking-wider uppercase text-coral hover:underline"
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
