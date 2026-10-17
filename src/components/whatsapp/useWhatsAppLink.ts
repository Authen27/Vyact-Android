// The WhatsApp phone-link flow, shared by Settings › WhatsApp and Pip's connect
// drawer (v10.54.0; extracted unchanged from components/settings/WhatsAppLink.tsx).
//
// A user links a WhatsApp number to ONE of their households via an OTP handshake:
// send → receive on WhatsApp → verify. Calls the Edge Functions `whatsapp-send-otp`
// / `whatsapp-verify-otp`; supabase-js attaches the user's JWT. Sending the code needs
// an approved WhatsApp template, so until Meta verifies the business the send step
// answers `otp_unavailable` and the person is told plainly (master to-do #74).
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { track } from '../../lib/analytics';
import { supabase } from '../../lib/supabase';
import { readWhatsAppLink } from '../../lib/whatsappLink';
import { confirmSheet } from '../../lib/confirmSheet';
import { unlinkWhatsAppRequest } from '../../lib/confirmCopy';

export type WhatsAppLinkPhase = 'loading' | 'unlinked' | 'code-sent' | 'linked';

export function useWhatsAppLink() {
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const session = useStore(s => s.session);
  const toast = useStore(s => s.toast);

  const [phase, setPhase] = useState<WhatsAppLinkPhase>('loading');
  const [phone, setPhone] = useState('');
  const [householdId, setHouseholdId] = useState(currentHouseholdId);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkedPhone, setLinkedPhone] = useState('');
  const [linkedHouseholdId, setLinkedHouseholdId] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const userId = session?.user?.id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase || !userId) { setPhase('unlinked'); return; }
      const data = await readWhatsAppLink();
      if (cancelled) return;
      if (data.status === 'linked' && data.phone) {
        setLinkedPhone(data.phone);
        setLinkedHouseholdId(data.householdId ?? '');
        setPhase('linked');
      } else {
        setPhase('unlinked');
      }
    })().catch(() => { if (!cancelled) { setPhase('unlinked'); toast('Could not load WhatsApp link status.', 'error'); } });
    return () => { cancelled = true; };
  }, [userId, toast]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function sendCode() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-send-otp', {
        body: { phone, householdId },
      });
      // A non-2xx reply leaves `data` null; the function's reason is on the response body.
      const reason: string | undefined = data?.error ?? (error
        ? await (error as { context?: Response }).context?.json?.().then((b: { error?: string }) => b?.error).catch(() => undefined)
        : undefined);
      if (reason === 'otp_unavailable') {
        toast("Linking by WhatsApp code isn't available yet: Meta is still verifying the business. Please try again later.", 'error');
      } else if (error || reason) {
        toast(`Couldn't send code: ${reason ?? 'try again'}`, 'error');
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
        track('whatsapp_linked');
        toast('WhatsApp number linked.', 'success');
      }
    } finally { setBusy(false); }
  }

  async function unlink() {
    if (!supabase || !userId) return;
    // Aurora 4.0 CF20 — say what stops working.
    const masked = linkedPhone ? `•••• ${linkedPhone.replace(/\D/g, '').slice(-4)}` : undefined;
    if (!(await confirmSheet(unlinkWhatsAppRequest({ phone: masked })))) return;
    setBusy(true);
    try {
      await readWhatsAppLink('unlink');
      setLinkedPhone(''); setLinkedHouseholdId(''); setPhone(''); setPhase('unlinked');
      toast('WhatsApp number unlinked.', 'info');
    } catch (error) {
      toast(`Unlink failed: ${(error as Error).message}`, 'error');
    } finally { setBusy(false); }
  }

  /** Back to the number step from the code step (wrong number, or no code arrived). */
  function editNumber() { setCode(''); setPhase('unlinked'); }

  return {
    phase, phone, setPhone, householdId, setHouseholdId, code, setCode, busy, cooldown,
    linkedPhone, linkedHouseholdId, sendCode, verifyCode, unlink, editNumber,
  };
}
