// The bell's "get these on your phone" prompt (v10.48.1).
//
// The owner's first test: alerts appeared in the bell and never on the lock screen,
// because the phone had never subscribed to push, and nothing in the bell said so. This
// card says it where the alerts are, and one tap subscribes the device (the tap is the
// user gesture the permission prompt needs). Shown in cloud mode only, when this
// device is not registered and push can work here; "Not now" hides it for the session.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { pushBlocker, deviceHasServerPush, devicePushStatus, enablePush, pushRefusalMessage } from '../../lib/webPush';

const DISMISS_KEY = 'vyact_phone_push_prompt_dismissed';

export default function PhonePushPrompt() {
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const session = useStore(s => s.session);
  const householdId = useStore(s => s.currentHouseholdId);
  const prefs = useStore(s => s.notificationPrefs);
  const updatePrefs = useStore(s => s.updateNotificationPrefs);
  const toast = useStore(s => s.toast);
  const cloud = cloudEnabled && !!session && !!householdId && householdId !== 'local';

  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { /* show it */ }
    if (!cloud || dismissed || pushBlocker() === 'unsupported' || !prefs.master) { setShow(false); return; }
    if (deviceHasServerPush()) {
      // The local marker can outlive a subscription the browser dropped; ask the server.
      void devicePushStatus().then(s => setShow(!(s.registered && s.active !== false)));
      return;
    }
    setShow(true);
  }, [cloud, prefs.master]);

  if (!show) return null;
  const iosHint = pushBlocker() === 'ios_not_installed';

  async function turnOn() {
    setBusy(true);
    setProblem(null);
    try {
      const r = await enablePush(householdId!, { ...prefs, webPushEnabled: true });
      if (!r.ok) { setProblem(pushRefusalMessage(r.reason, r.detail)); return; }
      updatePrefs({ webPushEnabled: true });
      toast('Phone notifications are on for this device', 'success');
      setShow(false);
    } finally {
      setBusy(false);
    }
  }

  function notNow() {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* hide for now anyway */ }
    setShow(false);
  }

  return (
    <div className="mx-1 mb-3 rounded-xl border border-coral/30 bg-coral/[0.06] px-3.5 py-3 space-y-2" data-testid="phone-push-prompt">
      <div className="text-sm font-semibold text-ink">Get these in your phone's notifications</div>
      <p className="text-[0.8rem] text-ink-dim">
        {iosHint
          ? pushRefusalMessage('ios_not_installed')
          : 'Right now alerts only show inside Vyact. Turn on phone notifications to see bills due and budgets at 80% on your lock screen, even when Vyact is closed.'}
      </p>
      {problem && <p className="text-[0.8rem] text-ink" role="alert">{problem}</p>}
      <div className="flex gap-2">
        {!iosHint && (
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void turnOn()}>
            {problem ? 'Try again' : 'Turn on phone notifications'}
          </button>
        )}
        <button type="button" className="btn-ghost btn-sm" onClick={notNow}>Not now</button>
      </div>
    </div>
  );
}
