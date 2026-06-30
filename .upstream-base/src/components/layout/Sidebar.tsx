import { NavLink, Link } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import {
  LayoutDashboard, ArrowLeftRight, Wallet, Repeat,
  TrendingUp, Users, Banknote, Scale, BarChart3,
  Home, Settings, HelpCircle, LogOut, BookOpen, CreditCard,
  Sun, Moon, Monitor, X,
} from 'lucide-react';
import { signOut as authSignOut } from '../../lib/auth';
import { useStore } from '../../store';
import ProfileSwitcher from './ProfileSwitcher';
import { useTranslation, useSwipeToClose } from '../../hooks';
import { pagesForTemplate } from '../../lib/templates';
import NotificationCenter from './NotificationCenter';
import { getMoneyMapMode } from '../../lib/featureFlags';

interface Props {
  open: boolean;
  onClose: () => void;
}

const navGroups = [
  { label: 'TRACK', items: [
    { to: '/dashboard',    key: 'dashboard',    page: 'dashboard',    icon: LayoutDashboard },
    { to: '/transactions', key: 'transactions', page: 'transactions', icon: ArrowLeftRight },
    { to: '/splits',       key: 'splits',       page: 'splits',       icon: Users },
    { to: '/recurring',    key: 'recurring',    page: 'recurring',    icon: Repeat },
  ]},
  { label: 'PLAN', items: [
    { to: '/budgets',  key: 'budgets',  page: 'budgets',  icon: Wallet },
    { to: '/debts',    key: 'debts',    page: 'debts',    icon: Banknote },
    { to: '/networth', key: 'networth', page: 'networth', icon: Scale },
    { to: '/accounts', key: 'accounts', page: 'accounts', icon: CreditCard },
  ]},
  { label: 'ANALYZE', items: [
    { to: '/reports',  key: 'reports',  page: 'reports',  icon: BarChart3 },
    { to: '/insights', key: 'insights', page: 'insights', icon: BookOpen },
  ]},
  { label: 'ACCOUNT', items: [
    { to: '/households', key: 'households', page: 'households', icon: Home },
  ]},
];

export default function Sidebar({ open, onClose }: Props) {
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const template = useStore(s => s.profile.template);
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const session = useStore(s => s.session);
  const visible = pagesForTemplate(template);
  // Always show new v7+ pages even outside template (they're additive ANALYZE tools)
  ['recurring','insights','households'].forEach(p => visible.add(p));
  // v7.1.3 — Accounts is gated on the Money Map flag rather than template,
  // so the link only appears once a household has opted into Money Map.
  if (getMoneyMapMode() !== 'off') visible.add('accounts');
  const { t } = useTranslation();

  // Lock body scroll while the mobile drawer is open. Without this, swiping
  // on the (overflow:auto) <nav> bubbles to the page once the nav reaches
  // its scroll boundary, so the page underneath drifts while the drawer is
  // up. Desktop is unaffected because the drawer is always visible.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isMobile = window.innerWidth < 1024;
    if (open && isMobile) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  // Shared handler so every nav link — grouped or footer — closes the
  // mobile drawer. The Settings / Help links at the footer used to skip
  // this, leaving the drawer open over the new page.
  const closeOnMobile = () => { if (window.innerWidth < 1024) onClose(); };

  // v7.4.5 — swipe-left on the open drawer closes it.
  const asideRef = useRef<HTMLElement | null>(null);
  useSwipeToClose(asideRef, onClose, open);

  return (
    <>
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/45 backdrop-blur-sm z-40"
          onClick={onClose}
        />
      )}
      <aside ref={asideRef} className={`fixed top-0 left-0 bottom-0 w-[260px] lg:w-60 bg-bg2 border-r border-line z-50 flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        {/* Logo — click to return to Dashboard */}
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-line relative">
          <Link
            to="/dashboard"
            onClick={() => { if (window.innerWidth < 1024) onClose(); }}
            className="flex items-center gap-2.5 flex-1 min-w-0 group rounded-md -mx-1 px-1 py-1 transition-colors hover:bg-coral-tint/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
            aria-label="Vyact — go to dashboard"
            title="Dashboard"
          >
            <Logo />
            <div className="text-2xl text-ink leading-none flex-1 group-hover:text-ink"
                 style={{ fontFamily: 'var(--ff-serif)', fontWeight: 500, letterSpacing: '-0.015em' }}>
              Vy<span style={{ fontStyle: 'italic', color: 'var(--ff-coral)' }}>act</span>
            </div>
          </Link>
          {/* Sync status moved to the ProfileSwitcher "Cloud sync" row (v9.5.10):
              the wide "Synced · 1m ago" pill overflowed the 240px rail and crowded
              the logo. Only the notification bell stays beside the wordmark. */}
          <div className="hidden lg:flex items-center">
            <NotificationCenter />
          </div>
          <button onClick={onClose} className="lg:hidden absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 border border-line rounded text-ink-mid hover:text-ink hover:border-line2 flex items-center justify-center">
            <X size={14} />
          </button>
        </div>

        {/* Profile switcher */}
        <ProfileSwitcher />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overscroll-contain py-2">
          {navGroups.map((group, gi) => (
            <div key={gi}>
              <div className="font-mono text-[0.56rem] tracking-[0.18em] uppercase text-ink-dim px-4 pt-3 pb-1.5">
                {group.label}
              </div>
              {group.items.filter(item => visible.has(item.page)).map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => { if (window.innerWidth < 1024) onClose(); }}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-4 py-2 text-[0.86rem] font-medium border-l-2 transition-all ${
                      isActive
                        ? 'text-coral bg-coral-tint border-l-coral font-semibold'
                        : 'text-ink-mid border-l-transparent hover:text-ink hover:bg-coral-tint/40 hover:border-l-line2'
                    }`
                  }
                >
                  <item.icon size={16} className="opacity-85" />
                  <span>{t(item.key)}</span>
                </NavLink>
              ))}
            </div>
          ))}

          <div className="h-px bg-line mx-4 my-2.5" />

          <NavLink to="/settings" onClick={closeOnMobile} className={({ isActive }) =>
            `flex items-center gap-2.5 px-4 py-2 text-[0.86rem] font-medium border-l-2 transition-all ${isActive ? 'text-coral bg-coral-tint border-l-coral font-semibold' : 'text-ink-mid border-l-transparent hover:text-ink hover:bg-coral-tint/40'}`
          }>
            <Settings size={16} /> {t('settings')}
          </NavLink>
          <NavLink to="/help" onClick={closeOnMobile} className={({ isActive }) =>
            `flex items-center gap-2.5 px-4 py-2 text-[0.86rem] font-medium border-l-2 transition-all ${isActive ? 'text-coral bg-coral-tint border-l-coral font-semibold' : 'text-ink-mid border-l-transparent hover:text-ink hover:bg-coral-tint/40'}`
          }>
            <HelpCircle size={16} /> {t('help')}
          </NavLink>
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-line space-y-1.5">
          <div className="grid grid-cols-3 gap-1 bg-bg3 p-1 rounded-md">
            {([
              ['warm', Sun],
              ['dark', Moon],
              ['system', Monitor],
            ] as const).map(([key, Icon]) => (
              <button
                key={key}
                onClick={() => setTheme(key)}
                title={key}
                className={`p-1.5 rounded flex items-center justify-center transition-all ${
                  theme === key ? 'bg-bg2 text-coral shadow-1' : 'text-ink-dim hover:text-ink-mid hover:bg-bg4'
                }`}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          {cloudEnabled && session && (
            <button
              onClick={async () => {
                if (confirm('Sign out of Vyact?')) {
                  try { await authSignOut(); }
                  catch { /* even on error, the auth listener clears state */ }
                }
              }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-[0.6rem] tracking-[0.1em] uppercase font-mono text-ink-mid border border-line rounded-md hover:border-coral hover:text-coral"
              title={session.user?.email || ''}
            >
              <LogOut size={12} /> Sign Out
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 36 36" width={32} height={32}>
      <defs>
        <radialGradient id="logo-grad" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#F4B6A8" />
          <stop offset="100%" stopColor="#E26D5C" />
        </radialGradient>
      </defs>
      <path d="M18 3 C 27 3, 33 9, 33 18 C 33 27, 27 33, 18 33 C 9 33, 3 27, 3 18 C 3 9, 9 3, 18 3 Z" fill="url(#logo-grad)" stroke="#2A2522" strokeWidth="1.2" />
      <ellipse cx="13" cy="16" rx="1.4" ry="1.8" fill="#2A2522" />
      <ellipse cx="23" cy="16" rx="1.4" ry="1.8" fill="#2A2522" />
      <circle cx="9.5" cy="20" r="1.6" fill="#F4B6A8" opacity="0.8" />
      <circle cx="26.5" cy="20" r="1.6" fill="#F4B6A8" opacity="0.8" />
      <path d="M14 22 Q 18 25, 22 22" stroke="#2A2522" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M18 3 Q 16 -1, 14 1 Q 17 3, 18 3 Z" fill="#85A88A" stroke="#2A2522" strokeWidth="0.8" />
    </svg>
  );
}
