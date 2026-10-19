// T4b (v10.125.0; audit XC-PRV-09; owner, 19 Oct 2026: "server record + accept on change").
//
// When the Terms / Privacy / Cookie text changes (POLICY_VERSION), a signed-in person whose recorded
// acceptance is an older version is asked once to accept the new one: what changed, links to read it, and
// Accept (recorded against the account with the version) or Sign out. The pages said consent would be
// renewed "where required", and nothing ever asked. AuthGate shows it, never over the legal pages
// themselves, so the text can be read first.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { POLICY_CHANGES, POLICY_VERSION, formatPolicyDate } from '../../lib/policyVersion';

export default function PolicyUpdateSheet({ onAccept, onSignOut }: { onAccept: () => Promise<void>; onSignOut: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { acceptRef.current?.focus(); }, []);

  async function accept() {
    setSaving(true); setError('');
    try { await onAccept(); }
    catch (e) { setError(`That didn't save: ${(e as Error).message}. Try again.`); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.45)' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="policy-update-title"
        className="card-raised w-full max-w-lg p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <h2 id="policy-update-title" className="font-display font-semibold text-xl text-ink mb-1">We&apos;ve updated our policies</h2>
        <p className="text-[12px] text-ink-dim mb-4">Terms, Privacy and Cookie Policy · {formatPolicyDate(POLICY_VERSION)}</p>
        <p className="text-[14px] text-ink-mid mb-2">What changed:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-[14px] text-ink-mid mb-4">
          {POLICY_CHANGES.map(c => <li key={c}>{c}</li>)}
        </ul>
        <p className="text-[13px] text-ink-mid mb-4">
          Read the <Link to="/privacy" target="_blank" className="text-coral hover:underline">Privacy Policy</Link>,{' '}
          <Link to="/terms" target="_blank" className="text-coral hover:underline">Terms of Service</Link> and{' '}
          <Link to="/cookies" target="_blank" className="text-coral hover:underline">Cookie Policy</Link>. By accepting you
          confirm you are 18 or older. If you don&apos;t accept, you can sign out; to have your data deleted, write to
          support@vyact.app.
        </p>
        {error && <p role="alert" className="text-[13px] mb-3" style={{ color: 'var(--crit-text)' }}>{error}</p>}
        <div className="flex gap-2 justify-end flex-wrap">
          <button type="button" className="btn-ghost min-h-[44px]" onClick={onSignOut} disabled={saving}>Sign out</button>
          <button type="button" ref={acceptRef} className="btn-primary min-h-[44px]" onClick={() => void accept()} disabled={saving}>
            {saving ? 'Saving…' : 'Accept and continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
