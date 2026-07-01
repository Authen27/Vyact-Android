import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, FileText, Clipboard, ShieldAlert, Cloud, Trash2, PauseCircle, XOctagon } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { fmt, today } from '../lib/format';
import { CURRENCIES, DEFAULT_RATES, LOCALES, PROFILE_TYPES } from '../constants';
import { sb } from '../lib/supabase';
import {
  enrollMfaTotp, verifyMfaEnrolment, listMfaFactors, unenrollMfaFactor, updatePassword,
  eraseHouseholdData, deactivateAccount, requestAccountDeletion, executeAccountDeletion, signOut,
  sendAccountActionCode, verifyAccountActionCode,
} from '../lib/auth';
import WhatsAppLink from '../components/settings/WhatsAppLink';
import { POLICY_VERSION } from './Privacy';
import type { Profile, Theme } from '../types';
import type { Factor } from '@supabase/supabase-js';

const THEMES: { key: Theme; label: string; desc: string }[] = [
  { key: 'warm',   label: 'Paper Warm', desc: 'Cream & coral — default' },
  { key: 'dark',   label: 'Dark',       desc: 'Warm palette on dark ink' },
  { key: 'system', label: 'System',     desc: 'Follow OS preference' },
];

const DATE_FORMATS: { key: Profile['dateFormat']; label: string; example: string }[] = [
  { key: 'us',  label: 'US',       example: 'May 9, 2026' },
  { key: 'eu',  label: 'European', example: '9 May 2026' },
  { key: 'iso', label: 'ISO',      example: '2026-05-09' },
];

// POLICY_VERSION is an ISO date string ('2026-07-01') — render it human-readable
// instead of the internal versioning format.
function formatPolicyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function Settings() {
  const { t } = useTranslation();
  const navigate    = useNavigate();
  const profile     = useStore(s => s.profile);
  const rates       = useStore(s => s.rates);
  const theme       = useStore(s => s.theme);
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const session      = useStore(s => s.session);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const transactions = useStore(s => s.transactions);
  const budgets     = useStore(s => s.budgets);
  const goals       = useStore(s => s.goals);
  const debts       = useStore(s => s.debts);
  const assets      = useStore(s => s.assets);
  const members     = useStore(s => s.members);
  const updateProfile = useStore(s => s.updateProfile);
  const upsertRate  = useStore(s => s.upsertRate);
  const resetRates  = useStore(s => s.resetRates);
  const setTheme    = useStore(s => s.setTheme);
  const toast       = useStore(s => s.toast);

  // Danger Zone (v9.8.0) — erase / deactivate / delete
  const [erasing, setErasing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deletePending, setDeletePending] = useState<string | null>(null); // ISO date once requested
  const [deleting, setDeleting] = useState(false);

  // Sends a 6-digit code to the account's own email and blocks until the
  // user enters it correctly. Every irreversible Danger Zone action must
  // pass this before it runs — a warm/idle browser session alone is not
  // sufficient proof the request is really coming from the account holder.
  async function confirmWithEmailCode(actionLabel: string): Promise<boolean> {
    let email: string;
    try {
      email = await sendAccountActionCode();
    } catch (e) {
      toast(`Could not send verification code: ${(e as Error).message}`, 'error');
      return false;
    }
    toast(`Verification code sent to ${email}`, 'info');
    const code = window.prompt(`Enter the 6-digit code sent to ${email} to confirm: ${actionLabel}`);
    if (!code) return false;
    try {
      await verifyAccountActionCode(email, code.trim());
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
  }

  async function onEraseHouseholdData() {
    if (!cloudEnabled || !session) { toast('Erase requires cloud mode', 'error'); return; }
    if (!window.confirm(
      'This permanently deletes every transaction, budget, debt, asset, account, goal, and recurring schedule in this household. Your login and household stay intact. This cannot be undone.\n\nContinue?'
    )) return;
    setErasing(true);
    try {
      if (!(await confirmWithEmailCode('erase all household data'))) return;
      await eraseHouseholdData(currentHouseholdId);
      toast('Household data erased', 'success');
      window.location.reload();
    } catch (e) {
      toast(`Erase failed: ${(e as Error).message}`, 'error');
    } finally { setErasing(false); }
  }

  async function onDeactivate() {
    if (!cloudEnabled || !session) { toast('Deactivation requires cloud mode', 'error'); return; }
    if (!window.confirm('Deactivate your account? You will be signed out immediately. Your data is kept exactly as-is and restored the moment you sign back in.')) return;
    setDeactivating(true);
    try {
      if (!(await confirmWithEmailCode('deactivate your account'))) return;
      await deactivateAccount();
      await signOut();
      toast('Account deactivated — sign in anytime to reactivate', 'info');
      navigate('/auth/sign-in');
    } catch (e) {
      toast(`Could not deactivate: ${(e as Error).message}`, 'error');
    } finally { setDeactivating(false); }
  }

  async function onRequestDeletion() {
    if (!cloudEnabled || !session) { toast('Account deletion requires cloud mode', 'error'); return; }
    if (!window.confirm(
      'This schedules PERMANENT deletion of your account and every household you own, in 30 days. You will be signed out now; signing back in within 30 days cancels the deletion. After 30 days this cannot be undone.\n\nContinue?'
    )) return;
    setDeleting(true);
    try {
      if (!(await confirmWithEmailCode('schedule permanent account deletion'))) return;
      const scheduledFor = await requestAccountDeletion();
      setDeletePending(scheduledFor);
      await signOut();
      toast(`Deletion scheduled for ${new Date(scheduledFor).toLocaleDateString()} — sign back in any time before then to cancel`, 'info');
      navigate('/auth/sign-in');
    } catch (e) {
      toast(`Could not schedule deletion: ${(e as Error).message}`, 'error');
    } finally { setDeleting(false); }
  }

  async function onDeleteImmediately() {
    if (!cloudEnabled || !session) return;
    if (!window.confirm('This immediately and irreversibly deletes your account and all data you own, skipping the 30-day undo window.\n\nContinue?')) return;
    setDeleting(true);
    try {
      if (!(await confirmWithEmailCode('delete your account immediately, skipping the undo window'))) return;
      await requestAccountDeletion();
      await executeAccountDeletion(true);
      toast('Account permanently deleted', 'info');
      navigate('/auth/sign-in');
    } catch (e) {
      toast(`Could not delete account: ${(e as Error).message}`, 'error');
    } finally { setDeleting(false); }
  }

  const [name, setName]       = useState(profile.name);
  const [email, setEmail]     = useState(profile.email);
  const [saving, setSaving]   = useState(false);
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});
  const [ratesOpen, setRatesOpen] = useState(false);
  const [extraPay, setExtraPay] = useState(String(profile.extraPayment || 0));

  // MFA / Security state (TD-15)
  const [mfaQr, setMfaQr] = useState('');
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaEnrolling, setMfaEnrolling] = useState(false);
  const [mfaFactors, setMfaFactors] = useState<Factor[]>([]);
  const [loadingFactors, setLoadingFactors] = useState(false);

  // Password change state (v7.4.4)
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwShow, setPwShow] = useState(false);

  async function savePassword() {
    if (pwNew.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    if (pwNew !== pwConfirm) { toast('Passwords do not match', 'error'); return; }
    setPwSaving(true);
    try {
      await updatePassword(pwNew);
      setPwNew(''); setPwConfirm(''); setPwShow(false);
      toast('Password updated', 'success');
    } catch (e) {
      toast(`Could not update password: ${(e as Error).message}`, 'error');
    } finally { setPwSaving(false); }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      await updateProfile({ name, email });
      toast('Profile saved', 'success');
    } catch { toast('Save failed', 'error'); }
    finally { setSaving(false); }
  }

  async function applyRate(code: string) {
    const val = parseFloat(rateEdits[code] ?? '');
    if (isNaN(val) || val <= 0) return;
    await upsertRate(code, val);
    setRateEdits(r => { const n = {...r}; delete n[code]; return n; });
    toast(`${code} rate updated`, 'success');
  }

  function downloadBackup() {
    const backup = {
      version: '6.4.9', exported: today(),
      profile, transactions, budgets, goals, members, debts, assets,
      exchangeRates: rates,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `vyact-backup-${today()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded', 'success');
  }

  function exportCSV() {
    const rows = [
      ['Date','Type','Description','Category','Amount','Currency','Note'],
      ...transactions.map(t => [t.date, t.type, t.description, t.category, t.amount, t.currency, t.note || '']),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `vyact-transactions-${today()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported', 'success');
  }

  async function saveDebtPrefs() {
    const ep = parseFloat(extraPay);
    await updateProfile({ extraPayment: isNaN(ep) ? 0 : ep });
    toast('Debt preferences saved', 'success');
  }

  const userEmail = session?.user?.email ?? profile.email;
  const emailVerified = Boolean(session?.user?.email_confirmed_at);

  async function resendVerification() {
    if (!userEmail) return;
    try {
      const { error } = await sb().auth.resend({ type: 'signup', email: userEmail });
      if (error) throw error;
      toast('Verification email sent — check your inbox', 'success');
    } catch (e) {
      toast(`Could not resend: ${(e as Error).message}`, 'error');
    }
  }

  async function fetchMfaFactors() {
    if (!cloudEnabled || !session) return setMfaFactors([]);
    setLoadingFactors(true);
    try {
      const factors = await listMfaFactors();
      setMfaFactors(factors?.all ?? []);
    } catch (e) {
      // ignore — best-effort UI
      setMfaFactors([]);
    } finally { setLoadingFactors(false); }
  }

  useEffect(() => {
    if (cloudEnabled && session) fetchMfaFactors();
  }, [cloudEnabled, session]);

  return (
    <div>
      <div className="flex justify-between items-start mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">{t('settings')}</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Profile · Appearance · Currency · Sync
          </p>
        </div>
      </div>

      <div className="space-y-4">

        {/* ── Profile ─────────────────────────────────────── */}
        <Panel title="Profile">
          <div className="p-5 grid sm:grid-cols-2 gap-4">
            <div>
              <label className="mono-label mb-1.5 block">Display Name</label>
              <input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div>
              <label className="mono-label mb-1.5 block">Email</label>
              <input className="input w-full" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="mono-label mb-1.5 block">Household Type</label>
              <select className="input w-full" value={profile.household}
                onChange={e => updateProfile({ household: e.target.value as Profile['household'] })}>
                {Object.entries(PROFILE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mono-label mb-1.5 block">Date Format</label>
              <select className="input w-full" value={profile.dateFormat}
                onChange={e => updateProfile({ dateFormat: e.target.value as Profile['dateFormat'] })}>
                {DATE_FORMATS.map(df => (
                  <option key={df.key} value={df.key}>{df.label} — {df.example}</option>
                ))}
              </select>
            </div>
            {cloudEnabled && session && (
              <div className="sm:col-span-2 flex items-center justify-between gap-3 bg-bg3 border border-line rounded-md px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className={`font-mono text-[0.6rem] tracking-widest uppercase px-2 py-0.5 rounded-full ${
                    emailVerified
                      ? 'bg-sage/10 border border-sage/30 text-sage'
                      : 'bg-honey/10 border border-honey/40 text-honey'
                  }`}>
                    {emailVerified ? 'Email verified' : 'Verification pending'}
                  </span>
                  <span className="text-[0.78rem] text-ink-mid">
                    {emailVerified
                      ? 'Password recovery is enabled.'
                      : 'You have full access — verifying enables password recovery.'}
                  </span>
                </div>
                {!emailVerified && (
                  <button className="btn-ghost text-xs py-1 px-2.5" onClick={resendVerification}>
                    Resend
                  </button>
                )}
              </div>
            )}

            <div className="sm:col-span-2 flex items-center justify-between gap-3">
              <Link
                to="/onboarding"
                className="text-[0.8rem] text-coral hover:underline font-medium"
              >
                {profile.onboardedAt ? 'Re-run onboarding wizard' : 'Run onboarding wizard'} →
              </Link>
              <button className="btn-primary" onClick={saveProfile} disabled={saving}>
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </div>
        </Panel>

        {/* ── WhatsApp link (cloud-only; renders nothing in local mode) ── */}
        <WhatsAppLink />

        {/* ── Appearance ──────────────────────────────────── */}
        <Panel title="Appearance">
          <div className="p-5 grid sm:grid-cols-3 gap-3">
            {THEMES.map(th => (
              <button key={th.key} onClick={() => setTheme(th.key)}
                className={`border-2 rounded-lg p-4 text-left transition-all ${
                  theme === th.key ? 'border-coral bg-coral/5' : 'border-line bg-bg3 hover:border-coral/40'
                }`}>
                <div className="text-sm font-semibold text-ink mb-0.5">{th.label}</div>
                <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim">{th.desc}</div>
                {theme === th.key && <div className="mt-2 text-[0.65rem] font-mono text-coral uppercase tracking-widest">Active</div>}
              </button>
            ))}
          </div>
        </Panel>

        {/* ── Localisation ────────────────────────────────── */}
        <Panel title="Language & Currency">
          <div className="p-5 grid sm:grid-cols-2 gap-4">
            <div>
              <label className="mono-label mb-1.5 block">Language</label>
              <select className="input w-full" value={profile.language}
                onChange={e => updateProfile({ language: e.target.value })}>
                {Object.entries(LOCALES).map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mono-label mb-1.5 block">Base Currency</label>
              <select className="input w-full" value={profile.baseCurrency}
                onChange={e => updateProfile({ baseCurrency: e.target.value })}>
                {Object.entries(CURRENCIES).map(([code, meta]) => (
                  <option key={code} value={code}>{meta.symbol} {code} — {meta.name}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mono-label mb-1.5 block">Number System</label>
              <select className="input w-full" value={profile.numberSystem ?? 'western'}
                onChange={e => updateProfile({ numberSystem: e.target.value as 'western' | 'indian' })}>
                <option value="western">Western — K (thousand) · M (million) · B (billion) · T (trillion)</option>
                <option value="indian">Indian — K (thousand) · L (lakh = 1,00,000) · Cr (crore = 1,00,00,000)</option>
              </select>
              <p className="text-[0.74rem] text-ink-dim mt-1.5">
                Used when large amounts are compacted (KPI tiles, summary rows, charts).
              </p>
            </div>
          </div>
        </Panel>

        {/* ── Exchange Rates (accordion, collapsed by default) ──── */}
        <Panel>
          <button
            type="button"
            onClick={() => setRatesOpen(o => !o)}
            aria-expanded={ratesOpen}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-bg3/40 transition-colors"
          >
            <div>
              <div className="display-italic text-2xl text-ink leading-tight">Exchange Rates</div>
              <div className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim mt-1">
                USD base · {Object.keys(CURRENCIES).length - 1} currencies
              </div>
            </div>
            <span className="text-ink-mid text-xl" aria-hidden>{ratesOpen ? '−' : '+'}</span>
          </button>
          {ratesOpen && (
            <div className="px-4 pb-4 border-t border-line">
              <p className="text-[0.84rem] text-ink-mid my-4">
                Rates relative to USD. All multi-currency amounts are converted through these.
              </p>
              <div className="grid sm:grid-cols-3 gap-2">
                {Object.entries(CURRENCIES).filter(([c]) => c !== 'USD').map(([code]) => (
                  <div key={code} className="flex items-center gap-2 bg-bg3 border border-line rounded-md px-3 py-2">
                    <span className="font-mono text-[0.7rem] text-ink-dim w-8 flex-shrink-0">{code}</span>
                    <input
                      className="input flex-1 text-right text-sm py-1 px-2"
                      value={rateEdits[code] ?? String(rates[code] ?? DEFAULT_RATES[code] ?? '')}
                      onChange={e => setRateEdits(r => ({ ...r, [code]: e.target.value }))}
                      onBlur={() => applyRate(code)}
                      onKeyDown={e => e.key === 'Enter' && applyRate(code)}
                      placeholder={String(DEFAULT_RATES[code] ?? '')}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <button className="btn-ghost btn-sm" onClick={() => { resetRates(); toast('Rates reset to defaults', 'info'); }}>
                  Reset to defaults
                </button>
              </div>
            </div>
          )}
        </Panel>

        {/* ── Debt Preferences ─────────────────────────────── */}
        <Panel title="Debt Preferences">
          <div className="p-5 grid sm:grid-cols-2 gap-4">
            <div>
              <label className="mono-label mb-1.5 block">Payoff Strategy</label>
              <select className="input w-full" value={profile.payoffStrategy}
                onChange={e => updateProfile({ payoffStrategy: e.target.value as Profile['payoffStrategy'] })}>
                <option value="avalanche">Avalanche — highest APR first (saves money)</option>
                <option value="snowball">Snowball — smallest balance first (motivation)</option>
              </select>
            </div>
            <div>
              <label className="mono-label mb-1.5 block">Monthly Extra Payment ({profile.baseCurrency})</label>
              <input className="input w-full" type="number" min="0" value={extraPay}
                onChange={e => setExtraPay(e.target.value)} placeholder="0" />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button className="btn-primary" onClick={saveDebtPrefs}>Save Preferences</button>
            </div>
          </div>
        </Panel>

        {/* ── Sync & Backup ────────────────────────────────── */}
        <Panel title="Sync & Backup">
          <div className="p-5 space-y-4">
            {cloudEnabled && (
              <div className="flex items-center gap-2.5 bg-sage/10 border border-sage/30 rounded-md px-4 py-3">
                <Cloud size={16} className="text-sage flex-shrink-0" />
                <span className="text-[0.84rem] text-ink">Cloud sync is active — data syncs automatically with Supabase.</span>
              </div>
            )}
            <div className="flex items-start gap-2.5 rounded-md border border-honey/40 bg-honey/10 px-4 py-3 text-[0.82rem] leading-relaxed text-ink">
              <ShieldAlert size={16} className="text-honey flex-shrink-0 mt-0.5" />
              <span>Exported files can leave the app and any destructive data-reset workflow should be triggered only from Settings after an explicit review. Treat these actions as sensitive and verify the destination before continuing.</span>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <button className="btn-secondary flex flex-col items-center justify-center gap-2 py-5 h-auto" onClick={downloadBackup}>
                <Download size={20} strokeWidth={1.6} />
                <span className="font-mono text-[11px] tracking-[0.08em] uppercase">Download Backup</span>
                <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-dim normal-case">JSON snapshot</span>
              </button>
              <button className="btn-secondary flex flex-col items-center justify-center gap-2 py-5 h-auto" onClick={exportCSV}>
                <FileText size={20} strokeWidth={1.6} />
                <span className="font-mono text-[11px] tracking-[0.08em] uppercase">Export CSV</span>
                <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-dim normal-case">Transactions</span>
              </button>
              <button className="btn-secondary flex flex-col items-center justify-center gap-2 py-5 h-auto"
                onClick={() => { navigator.clipboard.writeText(JSON.stringify({ profile, transactions, budgets, goals, debts, assets }, null, 2)); toast('Copied to clipboard', 'success'); }}>
                <Clipboard size={20} strokeWidth={1.6} />
                <span className="font-mono text-[11px] tracking-[0.08em] uppercase">Copy to Clipboard</span>
                <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-dim normal-case">Full backup</span>
              </button>
            </div>
          </div>
        </Panel>

        {/* ── Password ─────────────────────────────────────── */}
        <Panel title="Password">
          <div className="p-5">
            {!cloudEnabled || !session ? (
              <div className="bg-bg3 border border-line rounded-md p-4 text-sm text-ink-mid">
                Password management requires cloud mode. Sign in with a cloud account to change your password.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-[0.9rem] text-ink-mid">
                  Update the password for <span className="font-mono text-ink">{userEmail}</span>. You stay signed in on this device.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mono-label mb-1.5 block">New password</label>
                    <input
                      type={pwShow ? 'text' : 'password'}
                      className="input w-full"
                      value={pwNew}
                      onChange={e => setPwNew(e.target.value)}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                    />
                  </div>
                  <div>
                    <label className="mono-label mb-1.5 block">Confirm new password</label>
                    <input
                      type={pwShow ? 'text' : 'password'}
                      className="input w-full"
                      value={pwConfirm}
                      onChange={e => setPwConfirm(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Re-enter"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="flex items-center gap-2 text-[0.85rem] text-ink-mid select-none cursor-pointer">
                    <input type="checkbox" checked={pwShow} onChange={e => setPwShow(e.target.checked)} />
                    Show passwords
                  </label>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={pwSaving || !pwNew || !pwConfirm}
                    onClick={savePassword}
                  >
                    {pwSaving ? 'Saving…' : 'Update password'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* ── Security ─────────────────────────────────────── */}
        <Panel title="Security">
          <div className="p-5 space-y-3">
            {!cloudEnabled || !session ? (
              <div className="bg-bg3 border border-line rounded-md p-4 text-sm text-ink-mid">
                Two-factor authentication requires cloud mode (Supabase). Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to enable.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-[0.9rem] text-ink-mid">Two-factor authentication (TOTP) adds an extra layer of account protection.</div>
                <div className="flex items-center gap-3">
                  <button className="btn-primary" onClick={async () => {
                    setMfaEnrolling(true);
                    try {
                      const enrolled = await enrollMfaTotp('Vyact TOTP');
                      // Supabase TOTP enrol returns { id, type:'totp', totp:{ uri, qr_code, secret } }.
                      const otpauth = enrolled?.type === 'totp' ? enrolled.totp.uri : null;
                      if (otpauth) setMfaQr(`https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(otpauth)}`);
                      setMfaFactorId(enrolled?.id ?? '');
                      await fetchMfaFactors();
                    } catch (e) {
                      toast(`MFA enrolment failed: ${(e as Error).message}`, 'error');
                    } finally { setMfaEnrolling(false); }
                  }} disabled={mfaEnrolling}>
                    {mfaEnrolling ? 'Working…' : 'Enable two-factor auth'}
                  </button>
                  {mfaQr && (
                    <div className="flex items-center gap-3">
                      <img src={mfaQr} alt="TOTP QR" className="w-24 h-24 border rounded-md" />
                      <div className="flex flex-col">
                        <input className="input w-40 mb-2" placeholder="Enter 6-digit code" value={mfaCode} onChange={e => setMfaCode(e.target.value)} />
                        <div className="flex gap-2">
                          <button className="btn-primary" onClick={async () => {
                            if (!mfaFactorId || !mfaCode) return toast('Enter code', 'error');
                            setMfaEnrolling(true);
                            try {
                              await verifyMfaEnrolment(mfaFactorId, mfaCode);
                              toast('Two-factor authentication enabled', 'success');
                              setMfaQr(''); setMfaCode(''); setMfaFactorId('');
                              await fetchMfaFactors();
                            } catch (e) { toast(`Verification failed: ${(e as Error).message}`, 'error'); }
                            finally { setMfaEnrolling(false); }
                          }}>{mfaEnrolling ? 'Verifying…' : 'Verify'}</button>
                        </div>
                      </div>
                    </div>
                  )}

                </div>

                <div>
                  <div className="text-sm font-semibold mb-2">Enrolled factors</div>
                  <div>
                    {loadingFactors ? <div className="text-sm text-ink-mid">Loading…</div> : (
                      mfaFactors.length === 0 ? <div className="text-sm text-ink-mid">No enrolled 2FA factors.</div> : (
                        <ul className="space-y-2">
                          {mfaFactors.map((f: any) => (
                            <li key={f.id} className="flex items-center justify-between bg-bg3 border border-line rounded-md p-2">
                              <div>
                                <div className="font-medium">{f.friendly_name || f.factor_type || 'Factor'}</div>
                                <div className="text-sm text-ink-mid">{f.status || 'unknown'}</div>
                              </div>
                              <div>
                                <button className="btn-ghost text-sm" onClick={async () => {
                                  if (!confirm('Unenroll this factor?')) return;
                                  try { await unenrollMfaFactor(f.id); toast('Factor removed', 'success'); await fetchMfaFactors(); }
                                  catch (e) { toast(`Could not remove factor: ${(e as Error).message}`, 'error'); }
                                }}>Remove</button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* ── Account Stats ────────────────────────────────── */}
        <Panel title="Account Stats">
          <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Transactions', value: transactions.length },
              { label: 'Budgets',      value: budgets.length },
              { label: 'Goals',        value: goals.length },
              { label: 'Debts',        value: debts.length },
              { label: 'Assets',       value: assets.length },
              { label: 'Members',      value: members.length },
              { label: 'Income txns',  value: transactions.filter(t => t.type === 'income').length },
              { label: 'Expense txns', value: transactions.filter(t => t.type === 'expense').length },
            ].map(s => (
              <div key={s.label} className="bg-bg3 border border-line rounded-md p-3 text-center">
                <div className="text-2xl font-semibold text-coral">{s.value}</div>
                <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim uppercase mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* ── Danger Zone ──────────────────────────────────── */}
        <Panel title="Danger Zone">
          <div className="p-5 space-y-4">
            {!cloudEnabled || !session ? (
              <div className="bg-bg3 border border-line rounded-md p-4 text-sm text-ink-mid">
                Data erasure and account controls require cloud mode. Sign in with a cloud account to manage them here.
              </div>
            ) : (
              <>
                <p className="text-[0.76rem] text-ink-dim -mt-1">
                  Every action below requires a verification code sent to your account email before it takes effect.
                </p>

                {deletePending && (
                  <div className="flex items-start gap-2.5 rounded-md border border-terra/40 bg-terra/10 px-4 py-3 text-[0.82rem] leading-relaxed text-ink">
                    <XOctagon size={16} className="text-terra flex-shrink-0 mt-0.5" />
                    <span>Account deletion is scheduled for {new Date(deletePending).toLocaleDateString()}. Sign back in before then to cancel.</span>
                  </div>
                )}

                <div className="border border-line rounded-md p-4">
                  <div className="flex items-start gap-3">
                    <Trash2 size={18} className="text-honey flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-ink">Erase all household data</div>
                      <div className="text-[0.82rem] text-ink-mid mt-0.5">Permanently deletes every transaction, budget, debt, asset, account, goal, and recurring schedule for this household. Your login and household stay intact — data is wiped, not archived. Export a backup first if you want a copy.</div>
                    </div>
                    <button className="btn-secondary text-xs whitespace-nowrap" onClick={onEraseHouseholdData} disabled={erasing}>
                      {erasing ? 'Erasing…' : 'Erase data'}
                    </button>
                  </div>
                </div>

                <div className="border border-line rounded-md p-4">
                  <div className="flex items-start gap-3">
                    <PauseCircle size={18} className="text-ink-dim flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-ink">Deactivate account (temporary)</div>
                      <div className="text-[0.82rem] text-ink-mid mt-0.5">Signs you out and places a hold on your account. Nothing is deleted — all data is kept exactly as-is and restored automatically the moment you sign back in.</div>
                    </div>
                    <button className="btn-secondary text-xs whitespace-nowrap" onClick={onDeactivate} disabled={deactivating}>
                      {deactivating ? 'Deactivating…' : 'Deactivate'}
                    </button>
                  </div>
                </div>

                <div className="border border-terra/40 rounded-md p-4 bg-terra/5">
                  <div className="flex items-start gap-3">
                    <XOctagon size={18} className="text-terra flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-ink">Delete account (permanent)</div>
                      <div className="text-[0.82rem] text-ink-mid mt-0.5">
                        Schedules permanent deletion of your account and every household you own, with a <strong>30-day undo window</strong> — sign back in any time before then to cancel automatically. After 30 days, your profile, owned households, and login are erased for good and cannot be recovered.
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-3">
                        <button className="btn-secondary text-xs whitespace-nowrap" onClick={onRequestDeletion} disabled={deleting}>
                          {deleting ? 'Working…' : 'Schedule deletion (30-day undo)'}
                        </button>
                        <button className="text-xs text-terra hover:underline whitespace-nowrap" onClick={onDeleteImmediately} disabled={deleting}>
                          Delete immediately instead
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </Panel>

        <Panel title="Legal & Policies">
          <div className="p-5 grid sm:grid-cols-3 gap-3">
            <Link to="/privacy" className="bg-bg3 border border-line rounded-md px-4 py-4 hover:border-coral/40 transition-colors">
              <div className="text-sm font-semibold text-ink mb-1">Privacy Policy</div>
              <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim uppercase">Last updated {formatPolicyDate(POLICY_VERSION)}</div>
            </Link>
            <Link to="/terms" className="bg-bg3 border border-line rounded-md px-4 py-4 hover:border-coral/40 transition-colors">
              <div className="text-sm font-semibold text-ink mb-1">Terms of Service</div>
              <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim uppercase">Last updated {formatPolicyDate(POLICY_VERSION)}</div>
            </Link>
            <Link to="/cookies" className="bg-bg3 border border-line rounded-md px-4 py-4 hover:border-coral/40 transition-colors">
              <div className="text-sm font-semibold text-ink mb-1">Cookie Policy</div>
              <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim uppercase">Last updated {formatPolicyDate(POLICY_VERSION)}</div>
            </Link>
          </div>
        </Panel>

      </div>
    </div>
  );
}
