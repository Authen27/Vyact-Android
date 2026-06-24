// Vyact — WhatsApp phone-link plug-in (Settings).
//
// The connection foundation: a user links a WhatsApp phone number to ONE of their
// households via an OTP handshake (send → receive on WhatsApp → verify). Workflow
// use-cases (logging transactions over chat) come later and key off this link.
//
// Cloud-only: rendered only when Supabase is configured. Calls the Edge Functions
// `whatsapp-send-otp` / `whatsapp-verify-otp`; the supabase-js client attaches the
// user's JWT automatically.

import { useEffect, useState } from 'react';
import { Panel } from '../ui/Card';
import Button from '../ui/Button';
import { Input, Select, Field } from '../ui/Input';
import { useStore } from '../../store';
import { supabase, isCloudEnabled } from '../../lib/supabase';

type Phase = 'loading' | 'unlinked' | 'code-sent' | 'linked';

export default function WhatsAppLink() {
  const households = useStore(s => s.households);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const session = useStore(s => s.session);
  const toast = useStore(s => s.toast);

  const [phase, setPhase] = useState<Phase>('loading');
  const [phone, setPhone] = useState('');
  const [householdId, setHouseholdId] = useState(currentHouseholdId);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkedPhone, setLinkedPhone] = useState('');
  const [linkedHouseholdId, setLinkedHouseholdId] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const userId = session?.user?.id;

  // Read current link status on mount (RLS lets a user read their own profile row).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase || !userId) { setPhase('unlinked'); return; }
      const { data } = await supabase
        .from('profiles')
        .select('phone_number, phone_verified_at, whatsapp_household_id')
        .eq('id', userId).maybeSingle();
      if (cancelled) return;
      if (data?.phone_verified_at && data.phone_number) {
        setLinkedPhone(data.phone_number);
        setLinkedHouseholdId(data.whatsapp_household_id ?? '');
        setPhase('linked');
      } else {
        setPhase('unlinked');
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  if (!isCloudEnabled()) return null;

  async function sendCode() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-send-otp', {
        body: { phone, householdId },
      });
      if (error || data?.error) {
        toast(`Couldn't send code: ${data?.error ?? 'try again'}`, 'error');
      } else {
        setPhase('code-sent'); setCooldown(60);
        toast('Code sent on WhatsApp — enter it below.', 'success');
      }
    } finally { setBusy(false); }
  }

  async function verifyCode() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-verify-otp', {
        body: { code },
      });
      if (error || data?.error) {
        toast(`Verification failed: ${data?.error ?? 'incorrect code'}`, 'error');
      } else {
        setLinkedPhone(data.phone); setLinkedHouseholdId(data.householdId);
        setPhase('linked'); setCode('');
        toast('WhatsApp number linked.', 'success');
      }
    } finally { setBusy(false); }
  }

  async function unlink() {
    if (!supabase || !userId) return;
    if (!confirm('Unlink your WhatsApp number?')) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('profiles')
        .update({ phone_number: null, phone_verified_at: null, whatsapp_household_id: null })
        .eq('id', userId);
      if (error) { toast(`Unlink failed: ${error.message}`, 'error'); return; }
      setLinkedPhone(''); setLinkedHouseholdId(''); setPhone(''); setPhase('unlinked');
      toast('WhatsApp number unlinked.', 'info');
    } finally { setBusy(false); }
  }

  const householdName = (id: string) => households.find(h => h.id === id)?.name ?? id;

  return (
    <Panel title="WhatsApp">
      <div className="p-4 space-y-3">
        <p className="text-[0.82rem] text-ink-mid">
          Link a WhatsApp number to a household. (Logging transactions over WhatsApp
          is coming soon — this connects your number first.)
        </p>

        {phase === 'loading' && <p className="text-[0.8rem] text-ink-dim">Checking status…</p>}

        {phase === 'linked' && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-sage/30 bg-sage/[0.06] px-3 py-2.5">
            <span className="text-[0.86rem] text-ink">
              ✅ Linked <strong>+{linkedPhone}</strong> → {householdName(linkedHouseholdId)}
            </span>
            <button onClick={unlink} disabled={busy}
              className="font-mono text-[0.6rem] tracking-wider uppercase text-terra hover:underline disabled:opacity-50">
              Unlink
            </button>
          </div>
        )}

        {phase === 'unlinked' && (
          <>
            <Field label="WhatsApp number" hint="include country code">
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 415 555 0100" />
            </Field>
            <Field label="Household">
              <Select value={householdId} onChange={e => setHouseholdId(e.target.value)}>
                {households.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </Select>
            </Field>
            <Button onClick={sendCode} disabled={busy || phone.replace(/\D/g, '').length < 8}>
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </>
        )}

        {phase === 'code-sent' && (
          <>
            <Field label="Verification code" hint="6 digits, sent on WhatsApp">
              <Input inputMode="numeric" value={code} maxLength={6}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" />
            </Field>
            <div className="flex items-center gap-2">
              <Button onClick={verifyCode} disabled={busy || code.length < 4}>
                {busy ? 'Verifying…' : 'Verify & link'}
              </Button>
              <button onClick={sendCode} disabled={busy || cooldown > 0}
                className="text-[0.78rem] text-coral hover:underline disabled:text-ink-dim disabled:no-underline">
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
