// FinFlow E2E — custom test fixture.
//
// Extends Playwright's base test with:
//   • determinism: a frozen clock (FIXED_NOW) + pinned crypto.randomUUID, so
//     month-based logic (today()/nowMonthKey()) and generated ids are stable.
//   • optional localStorage seeding via `test.use({ seed })`.
//   • Page Objects exposed as fixtures.
//   • `advanceClock(toEpochMs | dateString)` to move the frozen clock forward
//     for time-sensitive tests (recurring schedules, deadlines, reminders).
//
// Usage:
//   import { test, expect } from '../fixtures/app';
//   test.use({ seed: defaultSeed });
//   test('...', async ({ page, dashboard, advanceClock }) => { ... });

import { test as base, expect, type Page } from '@playwright/test';
import {
  FIXED_NOW_MS, determinismScript, seedScript, type SeedData,
} from './seed';
import { DashboardPage } from '../pages/DashboardPage';
import { TransactionsPage } from '../pages/TransactionsPage';
import { TransactionFormModal } from '../pages/TransactionFormModal';
import { NetWorthPage } from '../pages/NetWorthPage';
import { BudgetsPage } from '../pages/BudgetsPage';
import { GoalsPage } from '../pages/GoalsPage';
import { DebtsPage } from '../pages/DebtsPage';
import { AssetsPage } from '../pages/AssetsPage';

type AdvanceClock = (to: number | string) => Promise<void>;

type AppFixtures = {
  /** Set via test.use({ seed }) to pre-populate localStorage before boot. */
  seed: SeedData | undefined;
  dashboard: DashboardPage;
  transactions: TransactionsPage;
  /** Modal Page Object — covers TransactionFormModal mounted at App root. */
  txnModal: TransactionFormModal;
  networth: NetWorthPage;
  budgets: BudgetsPage;
  goals: GoalsPage;
  debts: DebtsPage;
  assets: AssetsPage;
  /**
   * Move the frozen clock forward. Accepts either an epoch-ms number or an
   * ISO-ish date string parseable by Date.parse. Re-applies the freeze with
   * the new "now" — timers continue to fire so the UI stays responsive.
   *
   *   await advanceClock('2026-06-15T12:00:00Z');
   *   await advanceClock(Date.now() + 7 * 24 * 3600 * 1000);
   */
  advanceClock: AdvanceClock;
};

export const test = base.extend<AppFixtures>({
  seed: [undefined, { option: true }],

  page: async ({ page, seed }, use) => {
    // Freeze wall-clock time so date-derived UI is deterministic, but let
    // timers still fire (setFixedTime, not install) so the app stays responsive.
    await page.clock.setFixedTime(FIXED_NOW_MS);
    // Pin uuid generation (runs before app scripts).
    await page.addInitScript(determinismScript);
    // Seed the household, if requested.
    if (seed) await page.addInitScript(seedScript, seed);
    await use(page);
  },

  advanceClock: async ({ page }, use) => {
    const advance: AdvanceClock = async (to) => {
      const ms = typeof to === 'number' ? to : Date.parse(to);
      if (Number.isNaN(ms)) throw new Error(`advanceClock: invalid time ${to}`);
      await page.clock.setFixedTime(ms);
    };
    await use(advance);
  },

  dashboard:    async ({ page }, use) => { await use(new DashboardPage(page)); },
  transactions: async ({ page }, use) => { await use(new TransactionsPage(page)); },
  txnModal:     async ({ page }, use) => { await use(new TransactionFormModal(page)); },
  networth:     async ({ page }, use) => { await use(new NetWorthPage(page)); },
  budgets:      async ({ page }, use) => { await use(new BudgetsPage(page)); },
  goals:        async ({ page }, use) => { await use(new GoalsPage(page)); },
  debts:        async ({ page }, use) => { await use(new DebtsPage(page)); },
  assets:       async ({ page }, use) => { await use(new AssetsPage(page)); },
});

export { expect, type Page };
