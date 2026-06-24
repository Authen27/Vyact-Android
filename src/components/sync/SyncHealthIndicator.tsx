// Vyact — production sync-health indicator (budget-sync-fix-plan Phase 3).
//
// The fault taxonomy (lib/faults.ts) records `unexpected` faults — contract
// violations and DROPPED WRITES — into a ring buffer and forwards them to a
// pluggable transport. The dev `FaultsPanel` polls the buffer; this is the
// USER-FACING counterpart that runs in production: it claims the transport and,
// when a write may not have reached the cloud, surfaces a quiet, dismissible
// banner with a Refresh action — so a silent data-loss is never invisible again.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { useStore } from '../../store';
import { setFaultTransport } from '../../lib/faults';
import { banner } from '../../lib/motion';

export default function SyncHealthIndicator() {
  const manualRefresh = useStore(s => s.manualRefresh);
  const [visible, setVisible] = useState(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const dismissedAt = useRef(0);

  useEffect(() => {
    // Owns the global fault transport in the running app (nothing else registers
    // one outside tests). Only `unexpected` faults reach here.
    setFaultTransport((rec) => {
      if (rec.kind !== 'unexpected') return;
      setCount(c => c + 1);
      if (rec.at >= dismissedAt.current) setVisible(true);   // re-surface only post-dismissal faults
    });
    return () => setFaultTransport(null);
  }, []);

  async function refresh() {
    setBusy(true);
    try { await manualRefresh(); setVisible(false); setCount(0); }
    catch { /* keep the banner up so the user can retry */ }
    finally { setBusy(false); }
  }
  function dismiss() { dismissedAt.current = Date.now(); setVisible(false); }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-live="polite"
          variants={banner}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed left-1/2 -translate-x-1/2 bottom-[84px] sm:bottom-5 z-[120] max-w-[92vw]
                     flex items-center gap-3 rounded-xl border border-honey/40 bg-bg2 shadow-3 px-4 py-2.5"
        >
          <AlertTriangle size={16} className="text-honey shrink-0" />
          <span className="text-[0.82rem] text-ink">
            Some changes may not have synced{count > 1 ? ` (${count})` : ''}.
          </span>
          <button
            onClick={refresh}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[0.78rem] font-medium text-coral hover:underline disabled:opacity-50"
          >
            <RotateCcw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={dismiss} aria-label="Dismiss" className="text-ink-dim hover:text-ink p-0.5">
            <X size={15} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
