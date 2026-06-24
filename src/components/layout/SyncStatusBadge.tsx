// TD-10 + R4 (sync fix) — sync status visibility & manual refresh.
//
// Surfaces the HybridAdapter's true sync health as a tappable Sidebar badge.
// Refresh-based sync (per product decision) means the user's mental model IS
// this badge: it must honestly show pending / failed / conflicts / offline and
// when we last converged — and tapping it triggers a full-sweep resync.
//
// State machine (worst-wins): Local · Offline · N Failed · N Conflict(s) ·
// Refreshing · Syncing · Synced "· 2m ago".

import { useEffect, useState } from 'react';
import Badge from '../ui/Badge';
import { useStore } from '../../store';

interface SyncAdapter {
  pendingOpCount?: () => number;
  pendingConflictCount?: () => number;
  pendingFailedCount?: () => number;
}

function agoLabel(ts: number | null): string {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export default function SyncStatusBadge() {
  const adapter = useStore(s => s.adapter) as SyncAdapter;
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const manualRefresh = useStore(s => s.manualRefresh);
  const lastSyncedAt = useStore(s => s.lastSyncedAt);
  const [pendingOps, setPendingOps] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [failed, setFailed] = useState(0);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [refreshing, setRefreshing] = useState(false);
  const [, force] = useState(0);   // re-render the "ago" label on a timer

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
      setPendingOps(typeof adapter.pendingOpCount === 'function' ? adapter.pendingOpCount() || 0 : 0);
      setConflicts(typeof adapter.pendingConflictCount === 'function' ? adapter.pendingConflictCount() || 0 : 0);
      setFailed(typeof adapter.pendingFailedCount === 'function' ? adapter.pendingFailedCount() || 0 : 0);
      force(n => n + 1);   // refresh the "ago" label
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [adapter, cloudEnabled]);

  if (!cloudEnabled) {
    return (
      <div data-testid="sync-status-badge">
        <Badge tone="neutral">Local</Badge>
      </div>
    );
  }

  const onTap = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await manualRefresh(); } finally { setRefreshing(false); }
  };

  // Worst-wins selection. `failed` and `conflicts` were previously invisible —
  // surfacing them is the core R4 honesty fix.
  let tone: 'neutral' | 'warn' | 'alert' | 'info' | 'good' = 'good';
  let label = `Synced${lastSyncedAt ? ` · ${agoLabel(lastSyncedAt)}` : ''}`;
  if (!online)            { tone = 'warn';  label = 'Offline'; }
  else if (refreshing)    { tone = 'info';  label = 'Refreshing…'; }
  else if (failed > 0)    { tone = 'alert'; label = `${failed} failed`; }
  else if (conflicts > 0) { tone = 'alert'; label = `${conflicts} conflict${conflicts > 1 ? 's' : ''}`; }
  else if (pendingOps > 0){ tone = 'info';  label = 'Syncing…'; }

  return (
    <button
      type="button"
      onClick={onTap}
      disabled={refreshing}
      data-testid="sync-status-badge"
      title={`Tap to refresh${lastSyncedAt ? ` — last synced ${agoLabel(lastSyncedAt)}` : ''}`}
      className="inline-flex items-center bg-transparent border-0 p-0 cursor-pointer disabled:cursor-wait"
    >
      <Badge tone={tone}>{label}</Badge>
    </button>
  );
}
