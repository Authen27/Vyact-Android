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
import { isCloudEnabled } from '../../lib/supabase';
import { useWhatsAppLink } from '../whatsapp/useWhatsAppLink';
import { readWhatsAppPreferences, saveWhatsAppPreferences, type WhatsAppPreferences } from '../../lib/whatsappPreferences';

/** Topics a person can switch off here. Bills and large-spend alerts are always on. */
const MUTABLE_TOPICS: { id: string; label: string; hint: string }[] = [
  { id: 'budgets', label: 'Budget alerts', hint: 'When a budget line reaches 80%.' },
  { id: 'splits', label: 'Split updates', hint: 'A split shared with you, one settled, or one to split.' },
  { id: 'recurring', label: 'Scheduled payments', hint: 'When a payment that posts itself has posted, with Undo.' },
];

/** v10.47.0 — insight topics, sent only with insights on. */
const INSIGHT_TOPICS: { id: string; label: string; hint: string }[] = [
  { id: 'payday', label: 'Payday', hint: 'When your salary lands: the room left after your fixed bills.' },
  { id: 'digest', label: 'Evening digest', hint: 'At 8:30 pm, what your household spent today (households of two or more).' },
  { id: 'summary', label: 'Month close', hint: 'On the 1st, how last month went.' },
];

/**
 * v10.42.0 (W2) — what Vyact may send to this number. Mirrors the chat commands
 * (STOP BUDGETS…), which change the same record. Marketing is off until turned on
 * here, where the consent and its time are recorded.
 */
function WhatsAppMessages() {
  const toast = useStore(s => s.toast);
  const [prefs, setPrefs] = useState<WhatsAppPreferences | null>(null);
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readWhatsAppPreferences()
      .then(p => { if (!cancelled) { setPrefs(p); setThreshold(String(p.large_txn_threshold)); } })
      .catch(() => { if (!cancelled) toast('Could not load WhatsApp message settings.', 'error'); });
    return () => { cancelled = true; };
  }, [toast]);

  if (!prefs) return <p className="text-[0.8rem] text-ink-dim">Loading message settings…</p>;

  async function save(patch: Parameters<typeof saveWhatsAppPreferences>[0]) {
    setBusy(true);
    try {
      const next = await saveWhatsAppPreferences(patch);
      setPrefs(next); setThreshold(String(next.large_txn_threshold));
    } catch (error) {
      toast(`Couldn't save: ${(error as Error).message}`, 'error');
    } finally { setBusy(false); }
  }

  function toggleTopic(id: string, on: boolean) {
    const muted = new Set(prefs!.muted_topics);
    if (on) muted.delete(id); else muted.add(id);
    void save({ mutedTopics: [...muted] });
  }

  function saveThreshold() {
    const n = Number(threshold.replace(/[^\d.]/g, ''));
    if (!(n > 0)) { setThreshold(String(prefs!.large_txn_threshold)); return; }
    if (n !== prefs!.large_txn_threshold) void save({ largeTxnThreshold: n });
  }

  const row = 'flex items-center justify-between gap-3 px-3.5 py-2.5';
  return (
    <div>
      <div className="mono-label mb-1.5">Messages I send you</div>
      <div className="rounded-r3 overflow-hidden" style={{ background: 'var(--well-bg)', boxShadow: 'var(--well-shadow)', border: '1px solid var(--well-border)' }}>
        <div className={`${row} opacity-60`}>
          <span className="text-[0.84rem] text-ink">Bill reminders and large-spend alerts
            <span className="mono-label ml-2 text-ink-dim">always on</span></span>
          <input type="checkbox" checked disabled className="accent-coral flex-shrink-0" aria-label="Bill reminders and large-spend alerts, always on" />
        </div>
        <label className={`${row} border-t border-line`}>
          <span className="text-[0.84rem] text-ink">Large-spend alert from</span>
          <Input inputMode="decimal" value={threshold} disabled={busy} aria-label="Large-spend alert threshold"
            onChange={e => setThreshold(e.target.value)} onBlur={saveThreshold}
            className="w-28 text-right" />
        </label>
        {MUTABLE_TOPICS.map(t => (
          <label key={t.id} className={`${row} border-t border-line cursor-pointer`}>
            <span>
              <span className="block text-[0.84rem] text-ink">{t.label}</span>
              <span className="block text-[0.74rem] text-ink-dim">{t.hint}</span>
            </span>
            <input type="checkbox" checked={!prefs.muted_topics.includes(t.id)} disabled={busy}
              onChange={e => toggleTopic(t.id, e.target.checked)} className="accent-coral flex-shrink-0" />
          </label>
        ))}
        <label className={`${row} border-t border-line cursor-pointer`}>
          <span>
            <span className="block text-[0.84rem] text-ink">Insights about my money</span>
            <span className="block text-[0.74rem] text-ink-dim">
              Payday, the evening digest and the month close read your figures, so they only come if you turn them on.
            </span>
          </span>
          <input type="checkbox" checked={prefs.insights_opt_in} disabled={busy}
            onChange={e => void save({ insightsOptIn: e.target.checked })} className="accent-coral flex-shrink-0" />
        </label>
        {prefs.insights_opt_in && INSIGHT_TOPICS.map(t => (
          <label key={t.id} className={`${row} border-t border-line cursor-pointer pl-7`}>
            <span>
              <span className="block text-[0.84rem] text-ink">{t.label}</span>
              <span className="block text-[0.74rem] text-ink-dim">{t.hint}</span>
            </span>
            <input type="checkbox" checked={!prefs.muted_topics.includes(t.id)} disabled={busy}
              onChange={e => toggleTopic(t.id, e.target.checked)} className="accent-coral flex-shrink-0" />
          </label>
        ))}
        <label className={`${row} border-t border-line cursor-pointer`}>
          <span>
            <span className="block text-[0.84rem] text-ink">Tips, weekly summary and reminders</span>
            <span className="block text-[0.74rem] text-ink-dim">
              Weekly summary, balance and budget set-up reminders, runway notes and tips. WhatsApp counts these as
              promotional, so they only come if you turn them on.
            </span>
          </span>
          <input type="checkbox" checked={prefs.marketing_opt_in} disabled={busy}
            onChange={e => void save({ marketingOptIn: e.target.checked })} className="accent-coral flex-shrink-0" />
        </label>
        <label className={`${row} border-t border-line cursor-pointer`}>
          <span>
            <span className="block text-[0.84rem] text-ink">Answer my questions here</span>
            <span className="block text-[0.74rem] text-ink-dim">
              Pip replies in the chat, like &quot;how much did I spend this month?&quot;. Figures can show on
              your phone&apos;s lock screen, so it is off until you turn it on.
            </span>
          </span>
          <input type="checkbox" checked={prefs.reads_enabled} disabled={busy}
            onChange={e => void save({ readsEnabled: e.target.checked })} className="accent-coral flex-shrink-0" />
        </label>
      </div>
      <p className="mt-1.5 text-[0.72rem] text-ink-dim">
        You can also reply STOP with a topic in the chat (STOP BUDGETS, STOP PAYDAY, STOP TIPS…), or STOP for
        everything optional. Each message goes out only once WhatsApp has approved it.
      </p>
    </div>
  );
}

/** `embedded` — rendered inside the Settings "Connections" row (Aurora 4.0 ST2), so no Panel of its own. */
export default function WhatsAppLink({ embedded = false }: { embedded?: boolean } = {}) {
  const households = useStore(s => s.households);
  // v10.54.0 — the link flow lives in useWhatsAppLink, shared with Pip's connect drawer.
  const {
    phase, phone, setPhone, householdId, setHouseholdId, code, setCode, busy, cooldown,
    linkedPhone, linkedHouseholdId, sendCode, verifyCode, unlink,
  } = useWhatsAppLink();

  if (!isCloudEnabled()) return null;

  const householdName = (id: string) => households.find(h => h.id === id)?.name ?? id;

  const body = (
      <div className={embedded ? 'px-3.5 pb-3 space-y-3' : 'p-4 space-y-3'}>
        <p className="text-[0.82rem] text-ink-mid">
          Link a WhatsApp number to a household, then log money by texting Vyact,
          no app needed. Entries you send are read on our server without AI. Pip answers
          questions in the chat only if you turn that on below.
        </p>

        {phase === 'loading' && <p className="text-[0.8rem] text-ink-dim">Checking status…</p>}

        {phase === 'linked' && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-sage/30 bg-sage/[0.06] px-3 py-2.5">
            <span className="text-[0.86rem] text-ink">
              ✅ Linked <strong>+{linkedPhone}</strong> → {householdName(linkedHouseholdId)}
            </span>
            <button onClick={unlink} disabled={busy}
              className="text-[12.5px] font-medium text-terra hover:underline disabled:opacity-50 min-h-[44px] px-1">
              Unlink
            </button>
          </div>
        )}

        {phase === 'linked' && (
          <div className="well px-3 py-2.5 text-[0.78rem] text-ink-mid leading-relaxed">
            <div className="ui-label mb-1.5">Text Vyact to log</div>
            <div className="space-y-0.5 font-mono text-[0.72rem]">
              <div><span className="text-ink">850 groceries hdfc</span> — an expense</div>
              <div><span className="text-ink">+50000 salary</span> — income</div>
              <div><span className="text-ink">moved 10000 to icici</span> — a transfer</div>
            </div>
            <p className="mt-2 text-[0.72rem] text-ink-dim">Asking for balances or reports? With &quot;Answer my questions here&quot; on, Pip answers in the chat. Otherwise it asks you to turn that on first; it never sends a link instead of an answer.</p>
          </div>
        )}

        {phase === 'linked' && <WhatsAppMessages />}

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
  );
  return embedded ? body : <Panel title="WhatsApp">{body}</Panel>;
}
