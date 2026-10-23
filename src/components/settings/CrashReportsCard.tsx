import { useState } from 'react';
import { useStore } from '../../store';
import { crashReportsAvailable, crashReportsOn, setCrashReports } from '../../lib/crashReporting';

// Settings ▸ About ▸ "Crash reports" (Android app, builds with Firebase's config only: everywhere else
// crashReportsAvailable() is false and nothing renders). This is the prominent disclosure and the one place
// crash reports are switched on; until then nothing is sent (rule R6, ANDROID-BUILD-RULES.md).
// Styled to match the page's own SettingRow rows, as SmsDetectionCard does.

export default function CrashReportsCard() {
  const toast = useStore(s => s.toast);
  const [on, setOn] = useState(crashReportsOn);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!crashReportsAvailable()) return null;

  async function change(next: boolean) {
    setBusy(true);
    try {
      const done = await setCrashReports(next);
      if (!done) { toast('Could not change crash reports. Try again.', 'warning'); return; }
      setOn(next);
      toast(next ? 'Crash reports are on.' : 'Crash reports are off.', next ? 'success' : 'info');
    } finally { setBusy(false); }
  }

  return (
    <div id="crash-reports">
      <button
        type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left border-none cursor-pointer bg-transparent"
      >
        <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] flex-shrink-0"
          style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>🛠</span>
        <span className="flex-1 text-[0.86rem] text-ink font-medium truncate">Crash reports</span>
        <span className="text-[12px] text-ink-dim whitespace-nowrap">{on ? 'On' : 'Off'}</span>
        <span className="text-ink-dim text-lg leading-none flex-shrink-0" aria-hidden
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}>›</span>
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 text-[0.8rem] text-ink-mid leading-relaxed space-y-3">
          <p>
            If Vyact crashes, it can send a report to Google (Firebase Crashlytics) so the problem can be found and fixed.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>A report holds the technical error, your phone model, the Android and app versions, and a random install ID.</li>
            <li>Vyact does not put your transactions, amounts, names or anything you typed into a report.</li>
            <li>It is off until you turn it on here, and you can turn it off at any time.</li>
            <li>This is only in the Android app.</li>
          </ul>
          <div className="flex items-center gap-2 flex-wrap">
            {on
              ? <button className="btn-secondary" disabled={busy} onClick={() => change(false)}>Turn off</button>
              : <button className="btn-primary" disabled={busy} onClick={() => change(true)}>{busy ? 'Working…' : 'Turn on'}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
