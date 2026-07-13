// Account menu (Aurora v10, handoff §6.5) — avatar pill on the rail gradient
// opening a glass dropdown: household switcher (ProfileSwitcher), the three
// Account routes, theme segmented control, and sign out.
import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Sun, Moon, Monitor, LogOut } from 'lucide-react';
import { useStore } from '../../store';
import { signOut as authSignOut } from '../../lib/auth';
import { ACCOUNT_ROUTES } from './navModel';
import ProfileSwitcher from './ProfileSwitcher';
import type { Theme } from '../../types';

const THEME_MODES: { key: Theme; label: string; icon: typeof Sun }[] = [
  { key: 'warm',   label: 'Light', icon: Sun },
  { key: 'dark',   label: 'Dark',  icon: Moon },
  { key: 'system', label: 'Auto',  icon: Monitor },
];

export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const households = useStore(s => s.households);
  const currentId = useStore(s => s.currentHouseholdId);
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const session = useStore(s => s.session);
  const active = households.find(h => h.id === currentId);

  const initials = (active?.name || 'My Household')
    .split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  // Close after navigating.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex items-center gap-2 h-10 pl-2.5 pr-1.5 rounded-pill border-none cursor-pointer"
        style={{ background: 'var(--canvas)', boxShadow: open ? 'var(--neu-inset)' : 'var(--neu-sm)', color: 'var(--ff-ink-2)' }}
      >
        <span className="mono-label hidden md:inline">{active?.type || 'family'}</span>
        <span
          className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white font-display font-bold text-[11px]"
          style={{ background: 'var(--rail)' }}
        >
          {initials}
        </span>
      </button>

      {open && (
        <div className="glass-panel absolute right-0 top-[calc(100%+10px)] w-[264px] rounded-r3 p-2 z-[60]">
          {/* Household identity + switcher (keeps every ProfileSwitcher feature: switch, sync status, manage) */}
          <div className="rounded-r2 overflow-hidden mb-1.5" style={{ background: 'var(--elevated)' }}>
            <ProfileSwitcher />
          </div>

          {ACCOUNT_ROUTES.map(r => (
            <NavLink
              key={r.to}
              to={r.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 w-full rounded-r1 px-2.5 py-2.5 text-[0.86rem] font-medium transition-colors ${
                  isActive ? 'text-coral' : 'text-ink-mid hover:text-ink hover:bg-bg3'
                }`}
              style={({ isActive }) => (isActive ? { background: 'var(--hoverbg)' } : undefined)}
            >
              <r.icon size={16} /> {r.label}
            </NavLink>
          ))}

          {/* Theme segmented control */}
          <div
            className="flex gap-1 p-1 mt-1.5 rounded-r2"
            style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-inset)' }}
            role="radiogroup" aria-label="Theme"
          >
            {THEME_MODES.map(m => {
              const on = theme === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => setTheme(m.key)}
                  role="radio" aria-checked={on}
                  className="flex-1 h-8 rounded-md border-none flex items-center justify-center gap-1.5 font-display text-[11px] font-semibold cursor-pointer"
                  style={on
                    ? { background: 'var(--canvas)', boxShadow: 'var(--neu-sm)', color: 'var(--accent)' }
                    : { background: 'transparent', color: 'var(--ff-ink-3)' }}
                >
                  <m.icon size={12} /> {m.label}
                </button>
              );
            })}
          </div>

          {cloudEnabled && session && (
            <button
              onClick={async () => {
                if (confirm('Sign out of Vyact?')) {
                  try { await authSignOut(); } catch { /* auth listener clears state */ }
                }
              }}
              title={session.user?.email || ''}
              className="w-full flex items-center justify-center gap-1.5 mt-1.5 px-3 py-2 mono-label rounded-r1 border border-line hover:border-coral hover:text-coral transition-colors"
            >
              <LogOut size={12} /> Sign Out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
