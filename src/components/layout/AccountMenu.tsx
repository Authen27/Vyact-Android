// Account menu (Aurora · board M7). The avatar (person, not household) opens
// this menu: a header (avatar + name + email · role), the account routes as
// board `.mrow` cards, the theme segmented control, sync status, and sign out.
// Mobile → a full-width top PullDownSheet (M7). Desktop → the anchored glass
// dropdown (the D-pattern equivalent). Household SWITCHING lives on the
// separate household chip (TopBar / MobileHeader), not here — this menu's
// "Households" row navigates to household management.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Sun, Moon, Monitor, LogOut, ChevronRight } from 'lucide-react';
import { useStore } from '../../store';
import { signOut as authSignOut } from '../../lib/auth';
import { roleLabel } from '../../lib/permissions';
import { ACCOUNT_ROUTES } from './navModel';
import PullDownSheet from '../ui/PullDownSheet';
import SyncStatusBadge from './SyncStatusBadge';
import type { Theme } from '../../types';

const THEME_MODES: { key: Theme; label: string; icon: typeof Sun }[] = [
  { key: 'warm',   label: 'Light', icon: Sun },
  { key: 'dark',   label: 'Dark',  icon: Moon },
  { key: 'system', label: 'Auto',  icon: Monitor },
];

export default function AccountMenu({ trigger = 'pill' }: { trigger?: 'pill' | 'avatar' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const households = useStore(s => s.households);
  const currentId = useStore(s => s.currentHouseholdId);
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const session = useStore(s => s.session);
  const profile = useStore(s => s.profile);
  const myRole = useStore(s => s.myRole);
  const active = households.find(h => h.id === currentId);

  const displayName = profile.name?.trim() || active?.name || 'My Household';
  const initials = displayName.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const role = myRole ? roleLabel(myRole) : (!cloudEnabled ? 'Owner' : null);
  const subline = [cloudEnabled ? (session?.user?.email ?? 'Cloud sync') : 'Local-only mode', role]
    .filter(Boolean).join(' · ');

  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  // Close after navigating.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const avatar = (size: number, font: number) => (
    <span
      className="rounded-full flex items-center justify-center font-display font-bold flex-shrink-0"
      style={{ width: size, height: size, fontSize: font, background: 'var(--coral-grad)', color: 'var(--accent-ink)' }}
    >
      {initials}
    </span>
  );

  // Full-width segmented control (chips flex-1). Rendered stacked UNDER the
  // "Theme" label so it never overflows the narrow (300px) desktop dropdown —
  // an inline .mrow with three labeled chips did (the "Auto" chip was clipped
  // by the glass panel edge). Works identically in the wider mobile sheet.
  const themeControl = (
    <div className="flex gap-1 p-1 rounded-pill w-full" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}
      role="radiogroup" aria-label="Theme">
      {THEME_MODES.map(m => {
        const on = theme === m.key;
        return (
          <button
            key={m.key}
            onClick={() => setTheme(m.key)}
            role="radio" aria-checked={on}
            className="flex-1 h-8 rounded-pill border-none flex items-center justify-center gap-1.5 font-display text-[11px] font-semibold cursor-pointer"
            style={on
              ? { background: 'var(--canvas)', boxShadow: 'var(--neu-sm)', color: 'var(--accent)' }
              : { background: 'transparent', color: 'var(--ff-ink-3)' }}
          >
            <m.icon size={12} /> {m.label}
          </button>
        );
      })}
    </div>
  );

  // Board §.mrow — neu card row: sunken-inset icon tile · label · chevron.
  const Body = (
    <div className="flex flex-col gap-2.5">
      {/* Header — avatar + name + email · role. */}
      <div className="flex items-center gap-3 px-0.5 pt-0.5 pb-1">
        {avatar(46, 16)}
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[16px] text-ink truncate">{displayName}</div>
          <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-ink-dim truncate">{subline}</div>
        </div>
      </div>

      {ACCOUNT_ROUTES.map(r => (
        <button
          key={r.to}
          type="button"
          onClick={() => { setOpen(false); navigate(r.to); }}
          className="flex items-center gap-3 px-3.5 py-3 rounded-r2 border-none cursor-pointer text-left"
          style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
        >
          <span className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
            <r.icon size={16} className="text-ink-mid" />
          </span>
          <span className="flex-1 font-semibold text-[14px] text-ink">{r.label}</span>
          <ChevronRight size={15} className="text-ink-dim flex-shrink-0" />
        </button>
      ))}

      {/* Theme row (board §.mrow) — label on top, the segmented control
          stacked full-width below it so three labeled chips fit at any
          container width (the desktop dropdown is only 300px). */}
      <div className="flex flex-col gap-2.5 px-3.5 py-2.5 rounded-r2"
        style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
        <div className="flex items-center gap-3">
          <span className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
            <Moon size={16} className="text-ink-mid" />
          </span>
          <span className="flex-1 font-semibold text-[14px] text-ink">Theme</span>
        </div>
        {themeControl}
      </div>

      {/* Sync status. */}
      <div className="flex items-center justify-between gap-2 px-1 pt-0.5 font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim">
        <span className="truncate min-w-0">{cloudEnabled ? 'Cloud sync' : 'Local-only mode'}</span>
        <span className="flex-shrink-0"><SyncStatusBadge /></span>
      </div>

      {/* Sign out — crit color (board M7). */}
      {cloudEnabled && session && (
        <button
          onClick={async () => {
            if (confirm('Sign out of Vyact?')) {
              try { await authSignOut(); } catch { /* auth listener clears state */ }
            }
          }}
          title={session.user?.email || ''}
          className="w-full flex items-center justify-center gap-1.5 mt-0.5 py-2.5 font-mono text-[9px] tracking-[0.15em] uppercase cursor-pointer border-none bg-transparent"
          style={{ color: 'hsl(var(--terra))' }}
        >
          <LogOut size={12} /> Sign out
        </button>
      )}
    </div>
  );

  const triggerBtn = trigger === 'avatar' ? (
    <button
      onClick={() => setOpen(o => !o)}
      aria-label="Account menu" aria-expanded={open}
      className="w-[30px] h-[30px] rounded-full border-none cursor-pointer flex items-center justify-center font-display font-bold text-[11px] flex-shrink-0"
      style={{ background: 'var(--coral-grad)', color: 'var(--accent-ink)' }}
    >
      {initials}
    </button>
  ) : (
    <button
      onClick={() => setOpen(o => !o)}
      aria-label="Account menu" aria-expanded={open}
      className="flex items-center h-10 px-1.5 rounded-pill border-none cursor-pointer"
      style={{ background: 'var(--canvas)', boxShadow: open ? 'var(--neu-inset)' : 'var(--neu-sm)' }}
    >
      <span className="w-[30px] h-[30px] rounded-full flex items-center justify-center font-display font-bold text-[11px]"
        style={{ background: 'var(--coral-grad)', color: 'var(--accent-ink)' }}>
        {initials}
      </span>
    </button>
  );

  // Mobile (avatar trigger) → M7 full-width pull-down sheet.
  if (trigger === 'avatar') {
    return (
      <>
        {triggerBtn}
        <PullDownSheet
          open={open}
          onClose={() => setOpen(false)}
          ariaLabel="Account menu"
          header={<div className="pt-6 pb-1" />}
        >
          {Body}
        </PullDownSheet>
      </>
    );
  }

  // Desktop (pill trigger) → anchored glass dropdown.
  return (
    <div ref={ref} className="relative">
      {triggerBtn}
      {open && (
        <div className="glass-panel absolute right-0 top-[calc(100%+10px)] w-[300px] rounded-r3 p-3 z-[60]">
          {Body}
        </div>
      )}
    </div>
  );
}
