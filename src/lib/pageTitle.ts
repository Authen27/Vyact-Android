// Page titles for the app's own routes (v10.56.0, master to-do B3). Every app route used to share
// one title, so browser tabs, history, bookmarks and any agent reading the page saw the same
// "Vyact" line everywhere. Each route now names itself; the brand and category close the title.
// The landing page (/) and the server-rendered public pages set their own titles.

export const APP_TITLE = 'Vyact — Family budget app';

const BY_SEGMENT: Record<string, string> = {
  dashboard: 'Dashboard', transactions: 'Transactions', budgets: 'Budgets', recurring: 'Recurring',
  debts: 'Debts', accounts: 'Accounts', networth: 'Net worth', reports: 'Reports', insights: 'Insights',
  splits: 'Splits', households: 'Households', settings: 'Settings', help: 'Help', chat: 'Pip',
  onboarding: 'Set up your household', privacy: 'Privacy Policy', terms: 'Terms of Service',
  cookies: 'Cookie Policy', invite: 'Join a household',
};

const AUTH: Record<string, string> = {
  'sign-up': 'Sign up', 'sign-in': 'Sign in', reset: 'Reset your password',
  'reset-password': 'Choose a new password', verified: 'Email verified',
};

/** The document title for an app path. */
export function titleFor(pathname: string): string {
  const [seg = '', sub = ''] = pathname.split('/').filter(Boolean);
  const name = seg === 'auth' ? AUTH[sub] : BY_SEGMENT[seg];
  return name ? `${name} · ${APP_TITLE}` : APP_TITLE;
}
