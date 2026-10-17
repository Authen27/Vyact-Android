// The device's sync health — online state and the outbox counts — read by the account-menu badge
// (SyncStatusBadge) and the page-level offline strip (OfflineStrip, Aurora 4.0 OF1). It was local to
// the badge; lifting it lets both say the same thing.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';

interface SyncAdapter {
  pendingOpCount?: () => number;
  pendingConflictCount?: () => number;
  pendingFailedCount?: () => number;
}

export interface SyncHealth {
  online: boolean;
  pendingOps: number;
  conflicts: number;
  failed: number;
}

export function useSyncHealth(): SyncHealth {
  const adapter = useStore(s => s.adapter) as SyncAdapter;
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [counts, setCounts] = useState({ pendingOps: 0, conflicts: 0, failed: 0 });
  const [, force] = useState(0);   // re-render callers' "ago" labels on the same timer

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!cloudEnabled || !adapter) return;
    const tick = () => {
      const next = {
        pendingOps: typeof adapter.pendingOpCount === 'function' ? adapter.pendingOpCount() || 0 : 0,
        conflicts: typeof adapter.pendingConflictCount === 'function' ? adapter.pendingConflictCount() || 0 : 0,
        failed: typeof adapter.pendingFailedCount === 'function' ? adapter.pendingFailedCount() || 0 : 0,
      };
      setCounts(prev => (prev.pendingOps === next.pendingOps && prev.conflicts === next.conflicts && prev.failed === next.failed ? prev : next));
      force(n => n + 1);
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [adapter, cloudEnabled]);

  return { online, ...counts };
}
