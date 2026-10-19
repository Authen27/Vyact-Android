// TD-10 + R4 (sync fix) — sync status visibility & manual refresh.
//
// Surfaces the HybridAdapter's true sync health as a tappable Sidebar badge.
// Refresh-based sync (per product decision) means the user's mental model IS
// this badge: it must honestly show pending / failed / conflicts / offline and
// when we last converged — and tapping it triggers a full-sweep resync.
//
// State machine (worst-wins): Local · Offline · N Failed · N Conflict(s) ·
// Refreshing · Syncing · Synced "· 2m ago" (the time of the cloud read behind the screen, F1a).

import { useState } from 'react';
import Badge from '../ui/Badge';
import { useStore } from '../../store';
import { useSyncHealth } from './useSyncHealth';

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
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const manualRefresh = useStore(s => s.manualRefresh);
  const lastSyncedAt = useStore(s => s.lastSyncedAt);
  // Online state and outbox counts, polled every 2 s (also re-renders the "ago" label).
  const { online, pendingOps, conflicts, failed } = useSyncHealth();
  const [refreshing, setRefreshing] = useState(false);

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
  // v10.110.0 (F1a, audit FE-SYN-08): the time is that of the cloud read behind what is on screen,
  // so a device whose cloud reads keep failing reads "Synced · 2h ago", never "just now". Until the
  // first cloud read of the session lands, it is still syncing.
  let tone: 'neutral' | 'warn' | 'alert' | 'info' | 'good' = lastSyncedAt ? 'good' : 'info';
  let label = lastSyncedAt ? `Synced · ${agoLabel(lastSyncedAt)}` : 'Syncing…';
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
