// Settings › Notifications › Push on this device (v10.48.0, TD-22).
//
// Cloud mode: real Web Push. The device subscribes with its push service and is
// registered with Vyact; the server raises and pushes, so alerts reach the lock screen
// with the app closed. "Send a test" proves the whole path on THIS device and shows
// what the push service answered.
//
// v10.48.1 — the switch shows what is TRUE for this device (registered with the
// server), not the saved preference. v10.48.0 showed the old "Browser push" setting,
// so a phone that had it on from before looked on and was never subscribed: the owner
// saw alerts in the bell and none on the lock screen, and nothing said why.
//
// Local-only mode keeps the old behaviour: a popup from the open app only.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { requestWebPushPermission } from '../../lib/notifications';
import {
  pushBlocker, enablePush, disablePush, sendTestPush, devicePushStatus, pushRefusalMessage,
  type DeviceStatus,
} from '../../lib/webPush';
import { forceReloadForUpdate } from '../../lib/pwa';

const TEST_ERRORS: Record<string, string> = {
  too_many_tests: 'Too many tests in a row. Try again in 10 minutes.',
  no_devices: "This device isn't registered any more. Turn push off and on again.",
};

function when(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function PushNotifications() {
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const session = useStore(s => s.session);
  const householdId = useStore(s => s.currentHouseholdId);
  const prefs = useStore(s => s.notificationPrefs);
  const updatePrefs = useStore(s => s.updateNotificationPrefs);
  const toast = useStore(s => s.toast);
  const cloud = cloudEnabled && !!session && !!householdId && householdId !== 'local';

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const blocker = pushBlocker();

  useEffect(() => {
    if (cloud) void devicePushStatus().then(setStatus);
  }, [cloud]);

  const registered = !!status?.registered && status.active !== false;
  // Cloud: on only when this device is really registered. Local-only: the preference.
  const on = cloud ? registered : prefs.webPushEnabled;
  // The saved setting says on, but this phone never subscribed (or was unsubscribed).
  const notSetUpHere = cloud && status !== null && prefs.webPushEnabled && !registered;

  async function turnOn() {
    setBusy(true);
    setProblem(null);
    setTestNote(null);
    try {
      // Straight from the tap: Android and iOS only prompt from a user gesture.
      const r = await enablePush(householdId!, { ...prefs, webPushEnabled: true });
      if (!r.ok) {
        setNeedsUpdate(r.reason === 'update_needed');
        setProblem(pushRefusalMessage(r.reason, r.detail));
        return;
      }
      updatePrefs({ webPushEnabled: true });
      setStatus(await devicePushStatus());
      toast('Phone notifications are on for this device', 'success');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await disablePush();
      updatePrefs({ webPushEnabled: false });
      setStatus({ registered: false });
      setTestNote(null);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(next: boolean) {
    if (!cloud) {
      if (next && !(await requestWebPushPermission())) {
        toast('Enable notifications for Vyact in your browser settings first', 'error');
        return;
      }
      updatePrefs({ webPushEnabled: next });
      return;
    }
    await (next ? turnOn() : turnOff());
  }

  async function runTest() {
    setBusy(true);
    setTestNote(null);
    try {
      const r = await sendTestPush();
      if (!r.ok) { setTestNote(TEST_ERRORS[r.error] ?? "The test couldn't be sent. Please try again."); return; }
      const mine = r.results[0];
      if (!mine) setTestNote("This device isn't registered any more. Turn push off and on again.");
      else if (mine.accepted) setTestNote(`Sent. The push service accepted it (${mine.status}); it should appear in your phone's notifications within a few seconds, even with Vyact closed.`);
      else if (mine.gone) setTestNote("This device's subscription has expired. Turn push off and on again.");
      else setTestNote(`The push service refused it (${mine.status}). Turn push off and on again.`);
      setStatus(await devicePushStatus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <div>
          <div className="text-sm font-semibold text-ink">Push notifications on this device</div>
          <div className="text-[0.76rem] text-ink-dim mt-0.5">
            {cloud
              ? "Bills due, budgets at 80% and balances to check, in your phone's notifications even when Vyact is closed. Action-required alerts only, never in quiet hours."
              : 'Show a system notification for action-required alerts while Vyact is open.'}
          </div>
        </div>
        <input
          type="checkbox"
          checked={on}
          disabled={busy || (cloud && status === null)}
          onChange={e => void toggle(e.target.checked)}
          className="accent-coral w-[18px] h-[18px] flex-shrink-0"
          aria-label="Push notifications on this device"
        />
      </label>

      {notSetUpHere && !problem && (
        <div className="rounded-lg border border-coral/30 bg-coral/[0.06] px-3 py-2.5 space-y-2" data-testid="push-not-set-up">
          <p className="text-[0.8rem] text-ink">
            Notifications are on in Vyact, but this phone isn't set up to receive them yet, so they only appear inside the app.
          </p>
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void turnOn()}>
            Turn on phone notifications
          </button>
        </div>
      )}

      {cloud && blocker === 'ios_not_installed' && !on && (
        <p className="text-[0.76rem] text-ink-dim">{pushRefusalMessage('ios_not_installed')}</p>
      )}

      {problem && (
        <div className="rounded-lg border border-line px-3 py-2.5 space-y-2" role="alert" data-testid="push-problem">
          <p className="text-[0.8rem] text-ink">{problem}</p>
          {needsUpdate
            ? <button type="button" className="btn-ghost btn-sm" onClick={() => void forceReloadForUpdate()}>Reload to update</button>
            : <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void turnOn()}>Try again</button>}
        </div>
      )}

      {cloud && registered && (
        <div className="rounded-lg border border-line px-3 py-2.5 space-y-2">
          <div className="text-[0.76rem] text-ink-dim" data-testid="push-status">
            {`Registered on this device${status?.last_success_at ? ` · last delivered ${when(status.last_success_at)}` : ''}`}
          </div>
          <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => void runTest()}>
            Send a test notification
          </button>
          {testNote && <p className="text-[0.76rem] text-ink" role="status">{testNote}</p>}
        </div>
      )}
    </div>
  );
}
