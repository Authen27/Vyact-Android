// Vyact — TD-03 phase B + R5 (sync fix)
//
// Surfaces the HybridAdapter's dead-letter buckets so a write is NEVER lost
// silently:
//   • `sync_conflicts` — a household member edited the same row before us, so
//     our guarded UPDATE was rejected (the `updated_at` precondition no longer
//     matched). Previously the only option was "Dismiss" (discard the edit).
//   • `sync_failed`    — an op that exhausted its retries. This was entirely
//     invisible before R5; a money write could vanish with no signal.
//
// Behaviour:
//   • Polls both buckets every 5 s (cheap localStorage reads).
//   • "Refresh & re-apply" pulls the latest server state, then re-queues the
//     dead-lettered ops as unconditional last-write-wins (the user has chosen
//     to re-apply their edit on top of the newer row) — no silent loss.
//   • "Dismiss" discards (the previous behaviour), kept for genuine give-ups.
//   • Cloud-mode-only — guarded by typeof checks; local-mode never sees it.

import { useEffect, useState } from 'react';
import { useStore } from '../../store';

interface DeadLetterAdapter {
  pendingConflictCount?: () => number;
  pendingFailedCount?: () => number;
  clearConflicts?: () => void;
  clearFailed?: () => void;
  retryDeadLettered?: (bucket: 'sync_conflicts' | 'sync_failed') => void;
}

export default function SyncConflictBanner() {
  const adapter = useStore(s => s.adapter) as DeadLetterAdapter;
  const manualRefresh = useStore(s => s.manualRefresh);
  const toast = useStore(s => s.toast);
  const [conflicts, setConflicts] = useState(0);
  const [failed, setFailed] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const has = typeof adapter?.pendingConflictCount === 'function'
      || typeof adapter?.pendingFailedCount === 'function';
    if (!has) return;
    const tick = () => {
      setConflicts(adapter.pendingConflictCount?.() || 0);
      setFailed(adapter.pendingFailedCount?.() || 0);
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [adapter]);

  const total = conflicts + failed;
  if (total === 0) return null;

  const reapply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Pull the latest server state first so the user re-applies on top of it.
      await manualRefresh();
      adapter.retryDeadLettered?.('sync_conflicts');
      adapter.retryDeadLettered?.('sync_failed');
      setConflicts(0); setFailed(0);
      toast('Re-applying your changes…', 'info');
    } finally { setBusy(false); }
  };

  const dismiss = () => {
    adapter.clearConflicts?.();
    adapter.clearFailed?.();
    setConflicts(0); setFailed(0);
  };

  const parts: string[] = [];
  if (conflicts > 0) parts.push(`${conflicts} edit${conflicts > 1 ? 's' : ''} hit a conflict`);
  if (failed > 0) parts.push(`${failed} change${failed > 1 ? 's' : ''} failed to sync`);

  return (
    <div
      role="alert"
      className="mb-4 rounded border border-terra/40 bg-terra/10 px-4 py-3 text-sm text-ink"
      data-testid="sync-conflict-banner"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true">⚠️</span>
        <div className="flex-1">
          <div className="font-medium">{parts.join(' · ')} — not saved to the cloud</div>
          <div className="mt-0.5 text-ink-mid">
            {conflicts > 0
              ? 'A household member changed the same item. '
              : ''}
            Re-apply to pull the latest and retry your change, or dismiss to discard it.
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={reapply}
            disabled={busy}
            className="rounded border border-coral/40 bg-coral/10 px-2 py-1 text-xs font-medium text-coral hover:bg-coral/20 disabled:opacity-60"
          >
            {busy ? 'Re-applying…' : 'Refresh & re-apply'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="rounded border border-ink/20 px-2 py-1 text-xs font-medium hover:bg-ink/5 disabled:opacity-60"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
