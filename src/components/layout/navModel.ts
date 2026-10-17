// Aurora nav model (v10) — sections replace the old sidebar groups.
// Single source of truth for TopBar section tabs, SubNav pills, the ⌘K
// command palette, and the mobile tab bar. Every v9 route stays reachable.
import {
  LayoutDashboard, ArrowLeftRight, Users, Repeat,
  Wallet, Banknote, Scale, CreditCard,
  BarChart3, BookOpen, Home, Settings, HelpCircle, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { pagesForTemplate } from '../../lib/templates';
import type { TemplateKey } from '../../lib/templates';

export interface NavRoute { to: string; page: string; label: string; icon: LucideIcon }
export interface NavSection { id: string; label: string; routes: NavRoute[] }

export const SECTIONS: NavSection[] = [
  { id: 'track', label: 'Track', routes: [
    { to: '/dashboard',    page: 'dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
    { to: '/transactions', page: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
    { to: '/splits',       page: 'splits',       label: 'Splits',       icon: Users },
  ]},
  { id: 'plan', label: 'Plan', routes: [
    { to: '/budgets',   page: 'budgets',   label: 'Budgets',   icon: Wallet },
    { to: '/recurring', page: 'recurring', label: 'Recurring', icon: Repeat },
    { to: '/debts',     page: 'debts',     label: 'Debts',     icon: Banknote },
    { to: '/accounts',  page: 'accounts',  label: 'Accounts',  icon: CreditCard },
  ]},
  { id: 'analyze', label: 'Analyze', routes: [
    { to: '/networth', page: 'networth', label: 'Net Worth', icon: Scale },
    { to: '/reports',  page: 'reports',  label: 'Reports',   icon: BarChart3 },
    { to: '/insights', page: 'insights', label: 'Insights',  icon: BookOpen },
  ]},
];

export const ACCOUNT_ROUTES: NavRoute[] = [
  { to: '/households', page: 'households', label: 'Households',   icon: Home },
  { to: '/settings',   page: 'settings',   label: 'Settings',     icon: Settings },
  { to: '/help',       page: 'help',       label: 'Help & Guide', icon: HelpCircle },
];

/** v10.53.0 (#67) — pages that belong to no section and not to the account menu. Pip's
 *  full page used to fall through to 'account', so it showed an "ACCOUNT ▸" sub-nav of
 *  Households / Settings / Help and an "Account · Vyact" mobile header. */
export const STANDALONE_ROUTES: NavRoute[] = [
  { to: '/chat', page: 'chat', label: 'Pip', icon: Sparkles },
];

/** Section containing a pathname; 'standalone' for a page of its own (Pip); 'account'
 *  when it lives in the avatar menu. */
export function sectionForPath(pathname: string): string {
  for (const s of SECTIONS) if (s.routes.some(r => pathname.startsWith(r.to))) return s.id;
  if (STANDALONE_ROUTES.some(r => pathname.startsWith(r.to))) return 'standalone';
  return 'account';
}

/** Same page-visibility rules the old Sidebar enforced (template + flags). */
export function visiblePages(template: TemplateKey | undefined): Set<string> {
  const visible = pagesForTemplate(template);
  ['accounts', 'recurring', 'insights', 'households', 'settings', 'help'].forEach(p => visible.add(p));
  return visible;
}
