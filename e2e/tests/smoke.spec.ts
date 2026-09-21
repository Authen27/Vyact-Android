import { test, expect } from '../fixtures/app';
import { defaultSeed, legacyOnlySeedScript } from '../fixtures/seed';

// Every route App.tsx actually registers. Keep this list in step with the
// <Route path=…> set: a route listed here but not registered never resolves, so
// the test times out after 30s instead of failing with a useful message — which
// is exactly how '/goals' (removed with the Goals module in v8.8.0) kept this
// suite, and therefore CI, red.
// '/planner' is not listed: since v10.29.0 it redirects to /insights?tab=for-you,
// so the URL never settles on it. INS-FC-002 asserts that redirect.
const PRIMARY_ROUTES = [
  '/dashboard',
  '/transactions',
  '/accounts',
  '/budgets',
  '/splits',
  '/debts',
  '/networth',
  '/reports',
  '/recurring',
  '/chat',
  '/insights',
  '/households',
  '/settings',
  '/help',
] as const;

const LEGAL_PAGES = [
  { path: '/privacy', heading: 'Privacy Policy' },
  { path: '/terms', heading: 'Terms of Service' },
  { path: '/cookies', heading: 'Cookies Policy' },
] as const;

// Test scenarios CON-E2E-001..004. See docs/TEST_SCENARIOS.md.
// ── Lane A · Foundation smoke tests ──────────────────────────────────────────
// Prove: (1) the app boots in local-only mode, (2) the determinism + seeding
// fixtures work end to end. Journey tests (add txn, budgets, debts, splits,
// backup/restore, persistence-on-refresh) build on this in Phase 2.

test.describe('App shell (unseeded)', () => {
  test('CON-E2E-001 · boots into the dashboard in local-only mode', async ({ page, dashboard }) => {
    // Since v10.33.0, "/" renders the public Landing page instead of
    // redirecting — going straight to /dashboard is how the app shell is
    // reached now. The no-auth-gate proof is that /dashboard renders directly
    // with no bounce to a sign-in route (a cloud build would show one).
    await dashboard.goto();
    await expect(page).toHaveTitle(/Vyact/i);
    await expect(dashboard.logoLink).toBeVisible();
  });

  test('CON-E2E-002 · does not render a cloud auth screen', async ({ page }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/auth\//);
  });

  test('CON-E2E-054 · the landing page itself renders at "/" in local-only mode with a single dashboard CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/(dashboard|auth)/);
    await expect(page.getByRole('heading', { name: /understand its money/i })).toBeVisible();
    // Multiple "Open Vyact" links exist on the page (hero, final CTA, footer) —
    // the hero one is first in DOM order.
    await page.getByRole('link', { name: 'Open Vyact', exact: true }).first().click();
    await page.waitForURL('**/dashboard');
  });

  test('CON-E2E-040 · tolerates corrupt localStorage payloads and falls back to clean defaults', async ({ page, transactions }) => {
    await page.addInitScript(() => {
      localStorage.setItem('vt_transactions', '{bad json');
      localStorage.setItem('vt_profile', '{bad json');
    });

    await transactions.goto();
    await expect(page.getByRole('heading', { name: /transactions/i })).toBeVisible();
    await expect(page.getByText('No transactions found')).toBeVisible();
  });
});

test.describe('Seeded household', () => {
  test.use({ seed: defaultSeed });

  test('CON-E2E-003 · seeded transactions are visible on the Transactions page', async ({ transactions }) => {
    await transactions.goto();
    await expect(transactions.row('E2E Salary')).toBeVisible();
    await expect(transactions.row('E2E Rent')).toBeVisible();
    await expect(transactions.row('E2E Grocery')).toBeVisible();
  });

  test('CON-E2E-004 · seeded data survives a full page reload (persistence guard)', async ({ page, transactions }) => {
    await transactions.goto();
    await expect(transactions.row('E2E Salary')).toBeVisible();
    await page.reload();
    // Regression guard for the v6.4 "data lost on refresh" class of bug.
    await expect(transactions.row('E2E Salary')).toBeVisible();
  });

  test('CON-E2E-041 · primary routed pages mount without page errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    for (const route of PRIMARY_ROUTES) {
      await page.goto(route);
      await page.waitForURL(`**${route}`);
      await expect(page.locator('main')).toBeVisible();
    }

    expect(pageErrors).toEqual([]);
  });

  test('CON-E2E-011 · legal pages render without auth and keep the shell linkable', async ({ page, dashboard }) => {
    for (const legalPage of LEGAL_PAGES) {
      await page.goto(legalPage.path);
      await page.waitForURL(`**${legalPage.path}`);
      await expect(page.getByRole('heading', { name: legalPage.heading })).toBeVisible();
      await expect(dashboard.logoLink).toBeVisible();
    }
  });
});

test.describe('Legacy localStorage boot path', () => {
  test('CON-E2E-042 · boots from legacy ff_* keys and writes back under vt_*', async ({ page, transactions }) => {
    await page.addInitScript(legacyOnlySeedScript, defaultSeed);

    await transactions.goto();
    await expect(transactions.row('E2E Salary')).toBeVisible();

    const storageState = await page.evaluate(() => ({
      hasLegacy: Boolean(localStorage.getItem('ff_transactions')),
      hasCurrent: Boolean(localStorage.getItem('vt_transactions')),
    }));

    expect(storageState.hasLegacy).toBe(true);
    expect(storageState.hasCurrent).toBe(true);
  });
});
