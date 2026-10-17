import { useState, useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, FileText, Clipboard, ShieldAlert, Cloud, Trash2, PauseCircle, XOctagon } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { fmt, today } from '../lib/format';
import { CURRENCIES, LOCALES } from '../constants';
import { FULLY_TRANSLATED, languageOptionLabel } from '../lib/i18n';
import { sb, isCloudEnabled } from '../lib/supabase';
import {
  updatePassword,
  eraseHouseholdData, deactivateAccount, executeAccountDeletion, AccountDeletionError, signOut,
  sendAccountActionCode, verifyAccountActionCode,
} from '../lib/auth';
import WhatsAppLink from '../components/settings/WhatsAppLink';
import WhatsAppIcon from '../components/whatsapp/WhatsAppIcon';
import { transactionsCsv, downloadCsv } from '../lib/transactionsCsv';
import { buildBackup } from '../lib/backup';
import PushNotifications from '../components/settings/PushNotifications';
import SmsDetectionCard from '../components/settings/SmsDetectionCard'; // ANDROID-OVERLAY — renders nothing outside the SMS sideload build
import { POLICY_VERSION } from './Privacy';
import Chip from '../components/ui/Chip';
import { Select } from '../components/ui/Input';
import {
  NOTIF_GROUPS, NOTIF_TYPE_LABEL, NOTIF_LOCKED, typeEnabled,
} from '../lib/notifications';
import type { Profile, Theme, NotifType } from '../types';
import { canEditHouseholdRow } from '../lib/permissions';
import PageHead from '../components/ui/PageHead';
import { askSheet, confirmSheet } from '../lib/confirmSheet';
import { deactivateRequest, deleteAccountRequest, eraseDataRequest, verificationCodeRequest } from '../lib/confirmCopy';

const THEMES: { key: Theme; label: string; desc: string }[] = [
  { key: 'dark',   label: 'Nocturne',   desc: 'Aurora dark — default' },
  { key: 'warm',   label: 'Mist',       desc: 'Aurora light' },
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

// Board E · M1/D1 — the grouped `.set-group` navigation list: a compact row
// (icon · label · optional value preview · chevron) per setting, grouped
// under a caption, expanding in place to reveal the exact same panel content
// that used to render open-by-default. One row open at a time per page.
function SettingRow({ icon, label, value, open, onToggle, children, id }: {
  icon: ReactNode; label: string; value?: string; open: boolean; onToggle: () => void;
  children: ReactNode; id?: string;
}) {
  return (
    <div id={id}>
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left border-none cursor-pointer bg-transparent"
      >
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] flex-shrink-0"
          style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
        >
          {icon}
        </span>
        <span className="flex-1 text-[0.86rem] text-ink font-medium truncate">{label}</span>
        {value && <span className="text-[12px] text-ink-dim whitespace-nowrap truncate max-w-[45%]">{value}</span>}
        <span
          className="text-ink-dim text-lg leading-none flex-shrink-0"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}
          aria-hidden
        >
          ›
        </span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

/** Aurora 4.0 ST1 — a row that goes somewhere instead of opening in place (same look as SettingRow). */
function SettingLinkRow({ icon, label, value, to }: { icon: ReactNode; label: string; value?: string; to: string }) {
  return (
    <Link to={to} className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
      <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] flex-shrink-0"
        style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>{icon}</span>
      <span className="flex-1 text-[0.86rem] text-ink font-medium truncate">{label}</span>
      {value && <span className="text-[12px] text-ink-dim whitespace-nowrap">{value}</span>}
      <span className="text-ink-dim text-lg leading-none flex-shrink-0" aria-hidden>›</span>
    </Link>
  );
}

/** Aurora 4.0 MIST3 — a tiny version of the theme itself: its own tokens, scoped by data-theme. */
function ThemePreview({ theme }: { theme: 'dark' | 'warm' }) {
  return (
    <div data-theme={theme} className="h-full w-full p-2" style={{ background: 'hsl(var(--bg))' }}>
      <div className="rounded-[7px] p-1.5 h-full flex flex-col gap-1" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
        <span className="h-1.5 w-[55%] rounded-full" style={{ background: 'hsl(var(--ink))' }} />
        <span className="h-1 w-[80%] rounded-full" style={{ background: 'hsl(var(--ink-dim))' }} />
        <span className="mt-auto h-2 w-[40%] rounded-full" style={{ background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

function SettingsGroup({ caption, danger, children }: { caption: string; danger?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="mono-label mb-1.5 px-1">{caption}</div>
      <div
        className="rounded-r3 divide-y divide-line overflow-hidden mb-4"
        style={danger
          ? { background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }
          : { background: 'var(--canvas)', boxShadow: 'var(--neu)' }}
      >
        {children}
      </div>
    </div>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const navigate    = useNavigate();
  const profile     = useStore(s => s.profile);
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
  const setTheme    = useStore(s => s.setTheme);
  const toast       = useStore(s => s.toast);
  const notificationPrefs = useStore(s => s.notificationPrefs);
  const updateNotificationPrefs = useStore(s => s.updateNotificationPrefs);

  // Danger Zone (v9.8.0) — erase / deactivate / delete
  const [erasing, setErasing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
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
    // Aurora 4.0 CF17 — a proper 6-digit field with Resend, not a browser prompt.
    const { ok, value: code } = await askSheet(verificationCodeRequest({
      email, action: actionLabel,
      resend: async () => {
        try { await sendAccountActionCode(); toast(`New code sent to ${email}`, 'info'); }
        catch (e) { toast(`Could not resend the code: ${(e as Error).message}`, 'error'); }
      },
    }));
    if (!ok || !code) return false;
    try {
      await verifyAccountActionCode(email, code);
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
  }

  async function onEraseHouseholdData() {
    if (!cloudEnabled || !session) { toast('Erase requires cloud mode', 'error'); return; }
    if (!(await confirmSheet(eraseDataRequest()))) return;
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
    if (!(await confirmSheet(deactivateRequest()))) return;   // Aurora 4.0 CF18
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

  // W1b (v10.63.0, owner decision): deletion is immediate. One server transaction erases the
  // account; the old 30-day schedule was never executed by anything. The server also checks
  // that the emailed code was just confirmed (a recent sign-in), not only this page.
  async function onDeleteAccount() {
    if (!cloudEnabled || !session) { toast('Account deletion requires cloud mode', 'error'); return; }
    if (!(await confirmSheet(deleteAccountRequest()))) return;
    setDeleting(true);
    try {
      if (!(await confirmWithEmailCode('permanently delete your account'))) return;
      await executeAccountDeletion();
      // The login is gone; clear this device's copy of the ledger too.
      await signOut().catch(() => undefined);
      toast('Account permanently deleted', 'info');
      navigate('/auth/sign-in');
    } catch (e) {
      const code = e instanceof AccountDeletionError ? e.code : '';
      if (code === 'transfer_required') {
        toast('You own a household other people use. Make one of them the owner first (Households › Members), then delete your account.', 'error');
      } else if (code === 'reauth_required') {
        toast('Please confirm with a new emailed code and try again.', 'error');
      } else {
        toast(`Could not delete account: ${(e as Error).message}`, 'error');
      }
    } finally { setDeleting(false); }
  }

  const [name, setName]       = useState(profile.name);
  const [saving, setSaving]   = useState(false);
  const [extraPay, setExtraPay] = useState(String(profile.extraPayment || 0));
  // W6 (audit FE-UIS-06): only the owner can change what lives on the household row. Everyone else
  // sees the values, read-only, instead of a "saved" toast for a write the database refuses.
  const myRole = useStore(s => s.myRole);
  const canEditHousehold = canEditHouseholdRow(myRole, cloudEnabled);
  const ownerOnlyNote = 'Only the household owner can change this.';

  // Board E · M1 — one row open at a time across the grouped settings list.
  // A direct #notifications deep-link (Help/legal footers already link there)
  // opens straight to that row instead of landing on a collapsed page.
  const [openRow, setOpenRow] = useState<string | null>(
    () => (typeof window !== 'undefined' && window.location.hash === '#notifications') ? 'notifications' : null,
  );
  const toggleRow = (key: string) => setOpenRow(r => r === key ? null : key);

  // W0 (owner decision, audit 2026-10-04): no two-factor authentication. The old Security
  // row enrolled TOTP factors that sign-in never challenged (FE-UIS-02) and sent the secret
  // to Google Charts to draw the QR (FE-PLT-02), so it promised protection it didn't give.

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
      // W7a (audit FE-UIS-13): the same emailed-code gate as the Danger Zone — an unlocked, signed-in
      // device alone must not be able to change the password and lock the owner out.
      if (!(await confirmWithEmailCode('change your password'))) return;
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
      // W6 (audit FE-UIS-06): the name only. The email field saved nowhere (no profile column, not the
      // sign-in address) while saying "Profile saved"; the account email is shown, not edited, here.
      await updateProfile({ name });
      toast('Profile saved', 'success');
    } catch { toast('Save failed', 'error'); }
    finally { setSaving(false); }
  }

  // One snapshot for both 'Download Backup' and 'Copy to Clipboard' (the copy used to leave out
  // members and the version while its button said 'Full backup'). W3b: no exchange rates — a
  // household has one currency and nothing is converted. W7a: built by lib/backup (all the data).
  function backupSnapshot() {
    const s = useStore.getState();
    return buildBackup({
      profile, transactions, budgets, goals, members, debts, assets,
      accounts: s.accounts, budgetAllocations: s.budgetAllocations,
      recurringSchedules: s.recurringSchedules, netWorthSnapshots: s.netWorthSnapshots,
    }, today(), __APP_VERSION__);
  }

  async function copyBackup() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(backupSnapshot(), null, 2));
      toast('Backup copied', 'success');
    } catch {
      toast('Could not copy — use Download Backup instead', 'error');
    }
  }

  function downloadBackup() {
    const backup = backupSnapshot();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `vyact-backup-${today()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded', 'success');
  }

  function exportCSV() {
    // v10.55.0 (#69) — one builder with the Transactions page; adds who added it, accounts, mode.
    downloadCsv(transactionsCsv(transactions, { members, accounts: useStore.getState().accounts, baseCurrency: profile.baseCurrency }), `vyact-transactions-${today()}.csv`);
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

  return (
    <div className="ui-pilot">
      <PageHead title={t('settings')} />

      <div className="space-y-4">

        {/* ── Profile (Aurora 4.0 ST1): a group of rows like the rest of the page, each with its editor ── */}
        <SettingsGroup caption="Profile">
          <SettingRow icon="👤" label="Display name" value={profile.name || undefined}
            open={openRow === 'name'} onToggle={() => toggleRow('name')}>
            <div className="px-3.5 pb-3">
              <label htmlFor="settings-display-name" className="mono-label mb-1.5 block">Display Name</label>
              <div className="flex gap-2">
                <input id="settings-display-name" className="input flex-1 min-w-0" value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveProfile(); } }} />
                <button className="btn-primary" onClick={saveProfile} disabled={saving || !name.trim() || name.trim() === profile.name}>
                  {saving ? 'Saving…' : 'Save name'}
                </button>
              </div>
            </div>
          </SettingRow>

          <SettingRow icon="✉️" label="Email"
            value={userEmail ? (cloudEnabled && session ? `${userEmail} · ${emailVerified ? 'verified' : 'not verified'}` : userEmail) : '—'}
            open={openRow === 'email'} onToggle={() => toggleRow('email')}>
            <div className="px-3.5 pb-3 space-y-2">
              <p id="settings-email" className="text-[0.9rem] text-ink break-all">{userEmail || '—'}</p>
              <p className="text-[12px] text-ink-dim">Your sign-in address. It is shown here, not changed here.</p>
              {cloudEnabled && session && (
                <div className="flex items-center justify-between gap-3 well px-4 py-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-[12px] font-medium px-2 py-0.5 rounded-full"
                      style={emailVerified
                        ? { background: 'color-mix(in srgb, hsl(var(--sage)) 14%, transparent)', color: 'var(--good-text)' }
                        : { background: 'color-mix(in srgb, hsl(var(--honey)) 14%, transparent)', color: 'var(--warn-text)' }}>
                      {emailVerified ? 'Email verified' : 'Verification pending'}
                    </span>
                    <span className="text-[0.78rem] text-ink-mid">
                      {emailVerified
                        ? 'Password recovery is enabled.'
                        : 'You have full access — verifying enables password recovery.'}
                    </span>
                  </div>
                  {!emailVerified && (
                    <button className="btn-ghost" onClick={resendVerification}>
                      Resend
                    </button>
                  )}
                </div>
              )}
            </div>
          </SettingRow>

          <SettingRow icon="📅" label="Date format" value={DATE_FORMATS.find(df => df.key === profile.dateFormat)?.example}
            open={openRow === 'date'} onToggle={() => toggleRow('date')}>
            <div className="px-3.5 pb-3">
              <label htmlFor="settings-date-format" className="mono-label mb-1.5 block">Date Format</label>
              <Select id="settings-date-format" value={profile.dateFormat}
                onChange={e => updateProfile({ dateFormat: e.target.value as Profile['dateFormat'] })}>
                {DATE_FORMATS.map(df => (
                  <option key={df.key} value={df.key}>{df.label} — {df.example}</option>
                ))}
              </Select>
            </div>
          </SettingRow>

          <SettingLinkRow icon="🧭" label={profile.onboardedAt ? 'Re-run the setup wizard' : 'Run the setup wizard'} to="/onboarding" />
        </SettingsGroup>

        {/* ── Connections (Aurora 4.0 ST2): WhatsApp is a row, not a standalone panel. Cloud only. ── */}
        {isCloudEnabled() && (
          <SettingsGroup caption="Connections">
            <SettingRow icon={<WhatsAppIcon size={14} className="text-[#25D366]" />} label="WhatsApp" id="whatsapp"
              open={openRow === 'whatsapp'} onToggle={() => toggleRow('whatsapp')}>
              <WhatsAppLink embedded />
            </SettingRow>
          </SettingsGroup>
        )}

        {/* ── Preferences (board E · .set-group grouped list) ── */}
        <SettingsGroup caption="Preferences">
          <SettingRow icon="◐" label="Appearance" value={THEMES.find(th => th.key === theme)?.label}
            open={openRow === 'appearance'} onToggle={() => toggleRow('appearance')}>
            <div className="px-3.5 pb-3 grid sm:grid-cols-3 gap-3">
              {THEMES.map(th => {
                const on = theme === th.key;
                return (
                  <button key={th.key} onClick={() => setTheme(th.key)}
                    className="rounded-r3 p-3.5 text-left border-none cursor-pointer transition-shadow"
                    style={{ background: 'var(--canvas)', boxShadow: on ? 'var(--neu-sm), 0 0 0 2px var(--accent)' : 'var(--neu-sm)' }}>
                    <div className="h-[64px] rounded-r2 overflow-hidden mb-2.5 flex" aria-hidden data-testid={`theme-preview-${th.key}`}>
                      {th.key === 'system'
                        ? <><div className="w-1/2"><ThemePreview theme="dark" /></div><div className="w-1/2"><ThemePreview theme="warm" /></div></>
                        : <ThemePreview theme={th.key === 'warm' ? 'warm' : 'dark'} />}
                    </div>
                    <div className="text-[0.86rem] font-display font-semibold text-ink mb-0.5">{th.label}</div>
                    <div className="text-[12px] text-ink-dim">{th.desc}</div>
                    {on && <div className="mt-2 text-[12px] font-medium" style={{ color: 'var(--accent-text)' }}>Active</div>}
                  </button>
                );
              })}
            </div>
          </SettingRow>

          <SettingRow icon="🔔" label="Notifications" id="notifications"
            open={openRow === 'notifications'} onToggle={() => toggleRow('notifications')}>
            <div className="px-3.5 pb-3 space-y-5">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div className="text-sm font-semibold text-ink">All notifications</div>
                  <div className="text-[0.76rem] text-ink-dim mt-0.5">Master switch — turns every alert on or off.</div>
                </div>
                <input
                  type="checkbox"
                  checked={notificationPrefs.master}
                  onChange={e => updateNotificationPrefs({ master: e.target.checked })}
                  className="accent-coral w-[18px] h-[18px] flex-shrink-0"
                />
              </label>

              {NOTIF_GROUPS.map(g => (
                <div key={g.label}>
                  <div className="mono-label mb-1.5">{g.label}</div>
                  <div className="rounded-r3 overflow-hidden" style={{ background: 'var(--well-bg)', boxShadow: 'var(--well-shadow)', border: '1px solid var(--well-border)' }}>
                    {g.types.map((ty: NotifType, i) => {
                      const locked = NOTIF_LOCKED.includes(ty);
                      const enabled = typeEnabled(notificationPrefs, ty);
                      return (
                        <label
                          key={ty}
                          className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${i > 0 ? 'border-t border-line' : ''} ${locked ? 'opacity-60' : 'cursor-pointer'}`}
                        >
                          <span className="text-[0.84rem] text-ink">
                            {NOTIF_TYPE_LABEL[ty]}
                            {locked && <span className="mono-label ml-2 text-ink-dim">always on</span>}
                          </span>
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={locked || !notificationPrefs.master}
                            onChange={e => updateNotificationPrefs({ perType: { ...notificationPrefs.perType, [ty]: e.target.checked } })}
                            className="accent-coral flex-shrink-0"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div>
                <div className="mono-label mb-1.5">Quiet hours</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="settings-quiet-start" className="mono-label mb-1 block">From</label>
                    <input id="settings-quiet-start" type="time" className="input w-full" value={notificationPrefs.quietStart}
                      onChange={e => updateNotificationPrefs({ quietStart: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="settings-quiet-end" className="mono-label mb-1 block">To</label>
                    <input id="settings-quiet-end" type="time" className="input w-full" value={notificationPrefs.quietEnd}
                      onChange={e => updateNotificationPrefs({ quietEnd: e.target.value })} />
                  </div>
                </div>
                <p className="text-[0.74rem] text-ink-dim mt-1.5">
                  Informational alerts are held during quiet hours; action-required alerts still badge the bell.
                </p>
              </div>

              <div>
                <div className="mono-label mb-1.5">Reminder lead time</div>
                <div className="flex gap-1.5">
                  {([1, 3, 7] as const).map(d => (
                    <Chip key={d} on={notificationPrefs.defaultLeadDays === d}
                      onClick={() => updateNotificationPrefs({ defaultLeadDays: d })}>
                      {d} day{d > 1 ? 's' : ''} before
                    </Chip>
                  ))}
                </div>
              </div>

              <PushNotifications />
            </div>
          </SettingRow>

          <SettingRow icon="🌐" label="Language & currency" value={`${profile.language.toUpperCase()} · ${profile.baseCurrency}`}
            open={openRow === 'language'} onToggle={() => toggleRow('language')}>
            <div className="px-3.5 pb-3 grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="settings-language" className="mono-label mb-1.5 block">Language</label>
                <Select id="settings-language" value={profile.language} disabled={!canEditHousehold}
                  onChange={e => updateProfile({ language: e.target.value })}>
                  {Object.keys(LOCALES).map(k => (
                    <option key={k} value={k}>{languageOptionLabel(k)}</option>
                  ))}
                </Select>
                {/* W8a (FE-UIS-15): only English is complete; the rest translate the navigation. */}
                {!FULLY_TRANSLATED.has(profile.language) && (
                  <p className="text-[0.75rem] text-ink-dim mt-1.5">Preview: only the navigation is translated so far; the rest of the app stays in English.</p>
                )}
              </div>
              <div>
                <label htmlFor="settings-currency" className="mono-label mb-1.5 block">Household currency</label>
                <Select id="settings-currency" value={profile.baseCurrency} disabled={!canEditHousehold}
                  onChange={e => updateProfile({ baseCurrency: e.target.value })}>
                  {Object.entries(CURRENCIES).map(([code, meta]) => (
                    <option key={code} value={code}>{meta.symbol} {code} — {meta.name}</option>
                  ))}
                </Select>
                {/* W3b (owner decision D14): one currency per household; changing it changes the symbol only. */}
                <p className="text-[0.74rem] text-ink-dim mt-1.5">
                  Every amount in this household is in this currency. Changing it changes the symbol only; amounts are not converted.
                </p>
                {!canEditHousehold && <p className="text-[0.74rem] text-ink-dim mt-1">{ownerOnlyNote}</p>}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="settings-number-system" className="mono-label mb-1.5 block">Number System</label>
                <Select id="settings-number-system" value={profile.numberSystem ?? 'western'}
                  onChange={e => updateProfile({ numberSystem: e.target.value as 'western' | 'indian' })}>
                  <option value="western">Western — K (thousand) · M (million) · B (billion) · T (trillion)</option>
                  <option value="indian">Indian — K (thousand) · L (lakh = 1,00,000) · Cr (crore = 1,00,00,000)</option>
                </Select>
                <p className="text-[0.74rem] text-ink-dim mt-1.5">
                  Used when large amounts are compacted (KPI tiles, summary rows, charts).
                </p>
              </div>
            </div>
          </SettingRow>

          <SettingRow icon="⬇️" label="Debt preferences" value={profile.payoffStrategy === 'avalanche' ? 'Avalanche' : 'Snowball'}
            open={openRow === 'debt'} onToggle={() => toggleRow('debt')}>
            <div className="px-3.5 pb-3 grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="settings-payoff" className="mono-label mb-1.5 block">Payoff Strategy</label>
                <Select id="settings-payoff" value={profile.payoffStrategy} disabled={!canEditHousehold}
                  onChange={e => updateProfile({ payoffStrategy: e.target.value as Profile['payoffStrategy'] })}>
                  <option value="avalanche">Avalanche — highest APR first (saves money)</option>
                  <option value="snowball">Snowball — smallest balance first (motivation)</option>
                </Select>
              </div>
              <div>
                <label htmlFor="settings-extra-payment" className="mono-label mb-1.5 block">Monthly Extra Payment ({profile.baseCurrency})</label>
                <input id="settings-extra-payment" className="input w-full" type="number" min="0" value={extraPay}
                  disabled={!canEditHousehold} onChange={e => setExtraPay(e.target.value)} placeholder="0" />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                {canEditHousehold
                  ? <button className="btn-primary" onClick={saveDebtPrefs}>Save Preferences</button>
                  : <p className="text-[0.74rem] text-ink-dim">{ownerOnlyNote}</p>}
              </div>
            </div>
          </SettingRow>
          <SmsDetectionCard /> {/* ANDROID-OVERLAY */}
        </SettingsGroup>

        {/* ── Data & security (board E · .set-group grouped list) ── */}
        <SettingsGroup caption="Data & security">
          <SettingRow icon="☁️" label="Sync & backup" value="JSON · CSV"
            open={openRow === 'sync'} onToggle={() => toggleRow('sync')}>
            <div className="px-3.5 pb-3 space-y-4">
              {!cloudEnabled && (
                <div className="rounded-md border border-line px-4 py-3 text-[0.84rem] text-ink">
                  Cloud not configured. Running locally only. Your data lives in this browser — download a backup to keep a copy.
                </div>
              )}
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
                  <span className="text-[13px] font-medium">Download Backup</span>
                  <span className="text-[12px] text-ink-dim">JSON snapshot</span>
                </button>
                <button className="btn-secondary flex flex-col items-center justify-center gap-2 py-5 h-auto" onClick={exportCSV}>
                  <FileText size={20} strokeWidth={1.6} />
                  <span className="text-[13px] font-medium">Export CSV</span>
                  <span className="text-[12px] text-ink-dim">Transactions</span>
                </button>
                <button className="btn-secondary flex flex-col items-center justify-center gap-2 py-5 h-auto"
                  onClick={() => void copyBackup()}>
                  <Clipboard size={20} strokeWidth={1.6} />
                  <span className="text-[13px] font-medium">Copy to Clipboard</span>
                  <span className="text-[12px] text-ink-dim">Full backup</span>
                </button>
              </div>
            </div>
          </SettingRow>

          <SettingRow icon="🔑" label="Password"
            open={openRow === 'password'} onToggle={() => toggleRow('password')}>
            <div className="px-3.5 pb-3">
              {!cloudEnabled || !session ? (
                <div className="well p-4 text-sm text-ink-mid">
                  Password management requires cloud mode. Sign in with a cloud account to change your password.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-[0.9rem] text-ink-mid">
                    Update the password for <span className="font-mono text-ink">{userEmail}</span>. You stay signed in on this device.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="settings-new-password" className="mono-label mb-1.5 block">New password</label>
                      <input
                        id="settings-new-password"
                        type={pwShow ? 'text' : 'password'}
                        className="input w-full"
                        value={pwNew}
                        onChange={e => setPwNew(e.target.value)}
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                      />
                    </div>
                    <div>
                      <label htmlFor="settings-confirm-password" className="mono-label mb-1.5 block">Confirm new password</label>
                      <input
                        id="settings-confirm-password"
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
          </SettingRow>

          <SettingRow icon="📊" label="Account stats"
            open={openRow === 'stats'} onToggle={() => toggleRow('stats')}>
            <div className="px-3.5 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Transactions', value: transactions.length },
                { label: 'Budgets',      value: budgets.length },
                { label: 'Debts',        value: debts.length },
                { label: 'Assets',       value: assets.length },
                { label: 'Members',      value: members.length },
                { label: 'Income txns',  value: transactions.filter(t => t.type === 'income').length },
                { label: 'Expense txns', value: transactions.filter(t => t.type === 'expense').length },
              ].map(s => (
                <div key={s.label} className="well p-3 text-center">
                  <div className="text-2xl font-semibold text-coral">{s.value}</div>
                  <div className="text-[12px] text-ink-dim mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </SettingRow>
        </SettingsGroup>

        {/* ── About (board E · .set-group) ─────────────────── */}
        <SettingsGroup caption="About">
          <SettingRow icon="📄" label="Legal & policies"
            open={openRow === 'legal'} onToggle={() => toggleRow('legal')}>
            <div className="px-3.5 pb-3 grid sm:grid-cols-3 gap-3">
              <Link to="/privacy" className="tile px-4 py-4 hover:shadow-neu-hover transition-shadow">
                <div className="text-sm font-semibold text-ink mb-1">Privacy Policy</div>
                <div className="text-[12px] text-ink-dim">Last updated {formatPolicyDate(POLICY_VERSION)}</div>
              </Link>
              <Link to="/terms" className="tile px-4 py-4 hover:shadow-neu-hover transition-shadow">
                <div className="text-sm font-semibold text-ink mb-1">Terms of Service</div>
                <div className="text-[12px] text-ink-dim">Last updated {formatPolicyDate(POLICY_VERSION)}</div>
              </Link>
              <Link to="/cookies" className="tile px-4 py-4 hover:shadow-neu-hover transition-shadow">
                <div className="text-sm font-semibold text-ink mb-1">Cookie Policy</div>
                <div className="text-[12px] text-ink-dim">Last updated {formatPolicyDate(POLICY_VERSION)}</div>
              </Link>
            </div>
          </SettingRow>
        </SettingsGroup>

        {/* ── Danger zone — quarantined (board E: sunken/inset, never merged
            into the regular groups so it can't be mistaken for a normal row) ── */}
        <SettingsGroup caption="Danger zone" danger>
          <SettingRow icon={<span style={{ color: 'var(--crit-text)' }}>⚠</span>} label="Delete · reset"
            open={openRow === 'danger'} onToggle={() => toggleRow('danger')}>
            <div className="px-3.5 pb-3 space-y-4">
              {!cloudEnabled || !session ? (
                <div className="well p-4 text-sm text-ink-mid">
                  Data erasure and account controls require cloud mode. Sign in with a cloud account to manage them here.
                </div>
              ) : (
                <>
                  <p className="text-[0.76rem] text-ink-dim -mt-1">
                    Every action below requires a verification code sent to your account email before it takes effect.
                  </p>

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
                          Deletes your account <strong>now</strong>: your login, your profile, and every household where you are the only member, with everything in it. In households you share, your entries stay with the household. If you own a household other people use, make one of them the owner first. This cannot be undone — download a backup first if you want a copy.
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-3">
                          <button className="btn-secondary text-xs whitespace-nowrap" onClick={onDeleteAccount} disabled={deleting}>
                            {deleting ? 'Deleting…' : 'Delete account'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </SettingRow>
        </SettingsGroup>

      </div>
    </div>
  );
}
