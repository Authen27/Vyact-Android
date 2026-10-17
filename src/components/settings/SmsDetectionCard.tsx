import { useCallback, useEffect, useState } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useStore } from '../../store';
import { smsState, requestSmsPermission, setSmsEnabled, type SmsState } from '../../lib/sms/bridge';

// Settings ▸ Preferences ▸ "Bank message detection" (Android sideload build only: smsState() is null
// everywhere else, and the row simply is not rendered). This is the prominent disclosure and the one
// place detection is switched on. Styled to match the page's own SettingRow rows.

const RESTRICTED_HINT =
  'Android did not allow it. If Vyact was installed from a file rather than the Play Store, Android 13 and later '
  + 'block this until you open Settings → Apps → Vyact → ⋮ (top right) → Allow restricted settings. '
  + 'Then come back here and try again.';

export default function SmsDetectionCard() {
  const toast = useStore(s => s.toast);
  const [st, setSt] = useState<SmsState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const refresh = useCallback(async () => { setSt(await smsState()); }, []);
  useEffect(() => {
    void refresh();
    // Coming back from Android's settings screens: re-read what the person changed there.
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  if (!st) return null;
  const on = st.enabled && st.granted;

  async function turnOn() {
    setBusy(true); setHint(null);
    try {
      const perm = await requestSmsPermission();
      if (!perm?.granted) { setHint(RESTRICTED_HINT); return; }
      // The prompt is a notification: make sure Android will show it.
      if (!perm.notificationsOn) await LocalNotifications.requestPermissions().catch(() => undefined);
      await setSmsEnabled(true);
      const now = await smsState();
      setSt(now);
      if (now && !now.notificationsOn) setHint('Notifications are off for Vyact, so the prompts cannot appear. Turn them on in Android settings → Apps → Vyact → Notifications.');
      else toast('Bank message detection is on.', 'success');
    } finally { setBusy(false); }
  }

  async function turnOff() {
    setBusy(true); setHint(null);
    try { await setSmsEnabled(false); await refresh(); toast('Bank message detection is off.', 'info'); }
    finally { setBusy(false); }
  }

  return (
    <div id="bank-messages">
      <button
        type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left border-none cursor-pointer bg-transparent"
      >
        <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] flex-shrink-0"
          style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>💬</span>
        <span className="flex-1 text-[0.86rem] text-ink font-medium truncate">Bank message detection</span>
        <span className="text-[12px] text-ink-dim whitespace-nowrap">{on ? 'On' : 'Off'}</span>
        <span className="text-ink-dim text-lg leading-none flex-shrink-0" aria-hidden
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}>›</span>
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 text-[0.8rem] text-ink-mid leading-relaxed space-y-3">
          <p>
            Vyact can look at new text messages that read like a bank or card alert — a payment, a purchase, a deposit —
            and ask whether to add each one as a transaction.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>It reads only messages that arrive after you turn this on, one at a time. It never reads your old messages.</li>
            <li>Reading happens on this phone. The text of a message is never uploaded or shared.</li>
            <li>Nothing is saved until you open the prompt, check the details and tap Save.</li>
            <li>One-time codes, offers, reminders and failed payments are ignored.</li>
            <li>You can turn this off here at any time.</li>
          </ul>

          {hint && <p role="alert" style={{ color: 'var(--warn-text)' }}>{hint}</p>}

          <div className="flex items-center gap-2 flex-wrap">
            {on
              ? <button className="btn-secondary" disabled={busy} onClick={turnOff}>Turn off</button>
              : <button className="btn-primary" disabled={busy} onClick={turnOn}>{busy ? 'Working…' : 'Turn on'}</button>}
            {on && !st.notificationsOn && (
              <span style={{ color: 'var(--warn-text)' }}>Notifications are off for Vyact, so prompts cannot appear.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
