// Pip on WhatsApp — the connect drawer (v10.54.0, owner design 2 Oct 2026).
//
// The entry point to WhatsApp from inside Pip, so nobody has to find it in Settings.
// Three states, one purpose — carry on the conversation with Pip in WhatsApp:
//   1. Connect your number  → we send a one-time code on WhatsApp
//   2. Enter the code       → the number is linked to a household
//   3. Connected            → "Open WhatsApp" + whether Pip may answer questions there
// The flow is the same OTP handshake as Settings › WhatsApp (useWhatsAppLink). Until
// Meta verifies the business, sending the code answers "not available yet".
import { useEffect, useState } from 'react';
import { Check, ArrowLeft, Settings as SettingsIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import AccessibleDialog from '../ui/AccessibleDialog';
import { Input, Select } from '../ui/Input';
import { useStore } from '../../store';
import { track } from '../../lib/analytics';
import { whatsappChatLink } from '../../lib/whatsappBrand';
import { readWhatsAppPreferences, saveWhatsAppPreferences } from '../../lib/whatsappPreferences';
import WhatsAppIcon from './WhatsAppIcon';
import { useWhatsAppLink } from './useWhatsAppLink';

const WA_GREEN = '#25D366';

export default function WhatsAppConnectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AccessibleDialog open={open} onClose={onClose} ariaLabel="WhatsApp" variant="sheet">
      {open && <ConnectBody onClose={onClose} />}
    </AccessibleDialog>
  );
}

function ConnectBody({ onClose }: { onClose: () => void }) {
  const households = useStore(s => s.households);
  const toast = useStore(s => s.toast);
  const flow = useWhatsAppLink();
  const [readsEnabled, setReadsEnabled] = useState<boolean | null>(null);
  const [savingReads, setSavingReads] = useState(false);

  useEffect(() => {
    if (flow.phase !== 'linked') return;
    let cancelled = false;
    readWhatsAppPreferences()
      .then(p => { if (!cancelled) setReadsEnabled(p.reads_enabled); })
      .catch(() => { if (!cancelled) setReadsEnabled(null); });
    return () => { cancelled = true; };
  }, [flow.phase]);

  async function toggleReads(on: boolean) {
    setSavingReads(true);
    try {
      const next = await saveWhatsAppPreferences({ readsEnabled: on });
      setReadsEnabled(next.reads_enabled);
    } catch (error) {
      toast(`Couldn't save: ${(error as Error).message}`, 'error');
    } finally { setSavingReads(false); }
  }

  const digits = flow.phone.replace(/\D/g, '');
  const householdName = (id: string) => households.find(h => h.id === id)?.name ?? 'your household';

  return (
    <div className="pb-2" data-testid="whatsapp-connect">
      {/* No negative top margin: on phones the sheet's scroll area has no top padding
          (sm:py-4 only), so -mt-1 cut 4px off the icon circle (owner, 2 Oct 2026). */}
      <div className="flex items-center gap-2.5 mb-5">
        <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${WA_GREEN}22`, color: WA_GREEN }}>
          <WhatsAppIcon size={18} />
        </span>
        <h2 className="font-display text-lg font-semibold text-ink">WhatsApp</h2>
      </div>

      {flow.phase === 'loading' && <p className="text-sm text-ink-dim py-6">Checking your WhatsApp connection…</p>}

      {flow.phase === 'unlinked' && (
        <form onSubmit={e => { e.preventDefault(); void flow.sendCode(); }} className="space-y-4">
          <div>
            <h3 className="text-[0.95rem] font-semibold text-ink">Connect your number</h3>
            <p className="text-sm text-ink-mid mt-1 leading-relaxed">
              Chat with Pip on WhatsApp: log what you spend, and ask about your money. We&apos;ll send a one-time code to verify your number.
            </p>
          </div>
          <label className="block">
            <span className="block text-[0.8rem] font-medium text-ink mb-1.5">WhatsApp number</span>
            <Input value={flow.phone} onChange={e => flow.setPhone(e.target.value)} inputMode="tel" autoComplete="tel"
              placeholder="+1 234 567 8900" aria-describedby="wa-number-hint" />
            <span id="wa-number-hint" className="block text-[0.74rem] text-ink-dim mt-1.5">Include your country code, e.g. +1 for the US, +44 for the UK.</span>
          </label>
          {households.length > 1 && (
            <label className="block">
              <span className="block text-[0.8rem] font-medium text-ink mb-1.5">Household</span>
              <Select value={flow.householdId} onChange={e => flow.setHouseholdId(e.target.value)}>
                {households.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </Select>
            </label>
          )}
          <button type="submit" disabled={flow.busy || digits.length < 8}
            className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-r2 text-sm font-semibold transition-colors disabled:cursor-not-allowed"
            style={digits.length >= 8 && !flow.busy
              ? { background: WA_GREEN, color: '#0b141a' }
              : { background: 'var(--sunken)', color: 'var(--ff-ink-3)' }}>
            <WhatsAppIcon size={17} /> {flow.busy ? 'Sending…' : 'Send verification code'}
          </button>
        </form>
      )}

      {flow.phase === 'code-sent' && (
        <form onSubmit={e => { e.preventDefault(); void flow.verifyCode(); }} className="space-y-4">
          <div>
            <h3 className="text-[0.95rem] font-semibold text-ink">Enter your code</h3>
            <p className="text-sm text-ink-mid mt-1">We sent a 6-digit code to <strong className="text-ink">{flow.phone}</strong> on WhatsApp.</p>
          </div>
          <Input value={flow.code} onChange={e => flow.setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            autoComplete="one-time-code" maxLength={6} placeholder="••••••" aria-label="Verification code"
            className="tracking-[0.5em] text-center text-lg" />
          <button type="submit" disabled={flow.busy || flow.code.length < 4}
            className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-r2 text-sm font-semibold disabled:cursor-not-allowed"
            style={flow.code.length >= 4 && !flow.busy ? { background: WA_GREEN, color: '#0b141a' } : { background: 'var(--sunken)', color: 'var(--ff-ink-3)' }}>
            {flow.busy ? 'Verifying…' : 'Verify and connect'}
          </button>
          <div className="flex items-center justify-between text-[0.8rem]">
            <button type="button" onClick={flow.editNumber} className="inline-flex items-center gap-1 text-ink-mid hover:text-ink min-h-[40px]">
              <ArrowLeft size={14} aria-hidden /> Use a different number
            </button>
            <button type="button" onClick={() => void flow.sendCode()} disabled={flow.busy || flow.cooldown > 0}
              className="text-coral hover:underline disabled:text-ink-dim disabled:no-underline min-h-[40px]">
              {flow.cooldown > 0 ? `Resend in ${flow.cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      {flow.phase === 'linked' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-r2 px-3.5 py-3" style={{ background: `${WA_GREEN}14`, border: `1px solid ${WA_GREEN}40` }}>
            <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: WA_GREEN, color: '#0b141a' }}><Check size={16} aria-hidden /></span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">Connected</div>
              <div className="text-[0.82rem] text-ink-mid">+{flow.linkedPhone} · {householdName(flow.linkedHouseholdId)}</div>
            </div>
          </div>
          <p className="text-sm text-ink-mid leading-relaxed">
            Message Pip on WhatsApp to log money, like <span className="text-ink">&quot;850 groceries&quot;</span> or <span className="text-ink">&quot;+5000 salary&quot;</span>.
          </p>
          {readsEnabled !== null && (
            <label className="flex items-start justify-between gap-3 rounded-r2 px-3.5 py-3 cursor-pointer" style={{ background: 'var(--sunken)' }}>
              <span>
                <span className="block text-sm text-ink">Let Pip answer my questions on WhatsApp</span>
                <span className="block text-[0.76rem] text-ink-dim mt-0.5">Answers can show figures on your phone&apos;s lock screen, so this is off until you turn it on.</span>
              </span>
              <input type="checkbox" className="accent-coral mt-1 flex-shrink-0" checked={readsEnabled} disabled={savingReads}
                onChange={e => void toggleReads(e.target.checked)} />
            </label>
          )}
          <a href={whatsappChatLink('Hi Pip')} target="_blank" rel="noopener noreferrer"
            onClick={() => track('whatsapp_chat_opened', { surface: 'ask' })}
            className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-r2 text-sm font-semibold"
            style={{ background: WA_GREEN, color: '#0b141a' }}>
            <WhatsAppIcon size={17} /> Open WhatsApp
          </a>
          <Link to="/settings" onClick={onClose} className="flex items-center justify-center gap-1.5 text-[0.8rem] text-ink-dim hover:text-ink min-h-[40px]">
            <SettingsIcon size={13} aria-hidden /> Messages, alerts and unlinking in Settings
          </Link>
        </div>
      )}
    </div>
  );
}
