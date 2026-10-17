// Aurora mobile header (Batch A fidelity pass · board M1 §m-header).
// The board has NO fixed top bar on phones — this header scrolls with the
// page. One row: pip → home · page identity (greeting on Home, section +
// page title elsewhere) · the page's own + · bell → NotificationSheet ·
// avatar → account menu. Desktop keeps TopBar; this renders below `sm` only.
// Aurora 4.0: the household-type chip is gone — the avatar carries a household
// badge and its menu holds the switcher (HDR1). The page's add action is the
// small outlined + next to the bell (PH1 B′), since the page title row is
// hidden on phones (X3).
import { Link, useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useStore } from '../../store';
import { Pip } from './Brand';
import AccountMenu from './AccountMenu';
import NotificationCenter from './NotificationCenter';
import { SECTIONS, ACCOUNT_ROUTES, STANDALONE_ROUTES, sectionForPath } from './navModel';
import { usePageAction } from './pageAction';

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
}

export default function MobileHeader() {
  const location = useLocation();
  const profile = useStore(s => s.profile);
  const pageAction = usePageAction();
  const plus = pageAction && pageAction.headerPlus !== false ? pageAction : null;

  const isHome = location.pathname === '/dashboard' || location.pathname === '/';
  const sectionId = sectionForPath(location.pathname);
  const section = SECTIONS.find(s => s.id === sectionId);
  const standalone = sectionId === 'standalone';   // v10.53.0 — Pip's own page
  const route = (section ? section.routes : standalone ? STANDALONE_ROUTES : ACCOUNT_ROUTES).find(r => location.pathname.startsWith(r.to));
  const firstName = (profile.name || '').trim().split(/\s+/)[0];

  return (
    // ANDROID-OVERLAY — status-bar inset. This header scrolls with the page (board M1 — no fixed bar on phones), but
    // it's still the FIRST element on screen at initial scroll position, so on
    // Android (edge-to-edge, viewport-fit=cover) it launches directly under the
    // status bar without this inset — pip/greeting/bell/avatar half-hidden.
    <div
      className="sm:hidden max-w-[1320px] mx-auto px-4 pb-3.5 flex items-center gap-2"
      style={{ paddingTop: 'max(10px, env(safe-area-inset-top, 0px))' }}
    >
      <Link to="/dashboard" aria-label="Home" className="flex-shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40">
        <Pip size={30} />
      </Link>

      {/* Page identity — greeting on Home (board M1), section·title elsewhere. */}
      <div className="flex-1 min-w-0">
        {isHome ? (
          <>
            <div className="text-[11.5px] leading-tight text-ink-dim">{greeting()}</div>
            <div className="font-display font-bold text-[18px] leading-tight tracking-tight text-ink truncate">
              {profile.name?.trim() || 'Welcome'}
            </div>
          </>
        ) : (
          <>
            <div className="text-[11.5px] leading-tight text-ink-dim">
              {section ? section.label : standalone ? 'Ask' : 'Account'}
            </div>
            <div className="font-display font-bold text-[18px] leading-tight tracking-tight text-ink truncate">
              {route?.label ?? 'Vyact'}
            </div>
          </>
        )}
      </div>

      {/* PH1 B′ — the page's own add action, a small outlined + (Transactions and the
          Dashboard leave it off: the tab bar's + already adds a transaction). */}
      {plus && (
        <button
          type="button"
          onClick={plus.onClick}
          aria-label={plus.label}
          title={plus.label.replace(/^\+\s*/, '')}
          data-testid="header-plus"
          className="flex-shrink-0 w-[38px] h-[38px] rounded-full flex items-center justify-center border cursor-pointer bg-transparent"
          style={{ borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)', color: 'var(--accent-text)' }}
        >
          <Plus size={18} strokeWidth={2.2} aria-hidden />
        </button>
      )}

      <NotificationCenter />
      <AccountMenu trigger="avatar" />
    </div>
  );
}
