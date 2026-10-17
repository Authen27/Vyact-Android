// Aurora 4.0 OF1 — say it on the page when the device is offline. Only the account-menu badge used
// to change to "Offline", so nobody saw it. The strip names how many changes are waiting on this
// device and clears itself once they have synced. Local-only households never sync, so they never
// see it.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useSyncHealth } from './useSyncHealth';

/** The strip's words, or null for no strip. `afterOutage`: the device was offline this session. */
export function offlineMessage(online: boolean, pendingOps: number, afterOutage: boolean): { lead: string; rest: string } | null {
  const changes = `${pendingOps} change${pendingOps === 1 ? '' : 's'}`;
  if (!online) {
    return {
      lead: "You're offline.",
      rest: pendingOps > 0
        ? `${changes} ${pendingOps === 1 ? 'is' : 'are'} saved on this device and will sync when you're back.`
        : "Anything you change is saved on this device and syncs when you're back.",
    };
  }
  // Back online with changes still queued after an outage: say they are going up; the strip
  // clears once they have. A routine background flush (no outage) never shows it.
  if (afterOutage && pendingOps > 0) return { lead: 'Back online.', rest: `Syncing ${changes} from this device…` };
  return null;
}

export default function OfflineStrip() {
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const { online, pendingOps } = useSyncHealth();
  const [afterOutage, setAfterOutage] = useState(false);
  useEffect(() => {
    if (!online) setAfterOutage(true);
    else if (pendingOps === 0) setAfterOutage(false);
  }, [online, pendingOps]);

  const message = cloudEnabled ? offlineMessage(online, pendingOps, afterOutage) : null;
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="offline-strip"
      className="flex items-center gap-2.5 px-3.5 py-2.5 mb-4 rounded-r2 text-[13px] text-ink"
      style={{
        background: 'color-mix(in srgb, hsl(var(--honey)) 12%, transparent)',
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, hsl(var(--honey)) 28%, transparent)',
      }}
    >
      <span aria-hidden style={{ color: 'var(--warn-text)' }}>⚡</span>
      <span className="flex-1"><b className="font-semibold">{message.lead}</b> {message.rest}</span>
    </div>
  );
}
