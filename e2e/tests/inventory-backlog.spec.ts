import { test } from '../fixtures/app';

type BlockedCase = {
  title: string;
  reason: string;
};

function registerBacklogSuite(
  suiteTitle: string,
  todoCases: readonly string[],
  blockedCases: readonly BlockedCase[] = [],
) {
  test.describe(suiteTitle, () => {
    for (const title of todoCases) {
      test(title, async () => {
        test.fixme(true, 'Backlog placeholder until the executable spec lands.');
      });
    }

    for (const blockedCase of blockedCases) {
      test(blockedCase.title, async () => {
        test.fixme(true, blockedCase.reason);
      });
    }
  });
}

// This file is the inventory backlog register. It exists so every open row in
// TEST_CASE_INVENTORY.md has a matching Playwright test ID in code, even when
// the app/page-object/test-hook surface is not ready for a full executable
// implementation yet. As executable specs land, move the ID into a dedicated
// suite and delete its todo/fixme entry here.

registerBacklogSuite('§0 CON-E2E · Foundation backlog', [
  'CON-E2E-008 · app tolerates corrupt localStorage payload',
  'CON-E2E-009 · initial dashboard render stays within performance budget',
]);

registerBacklogSuite('§1 TXN-FC · Transaction Creation backlog', [
  'TXN-FC-006 · future-date policy matches the decided product rule',
]);

registerBacklogSuite('§2 TXN-EDIT-FC · Transaction Edit Propagation backlog', [
  'TXN-EDIT-FC-001 · amount edit recomputes NetWorth',
  'TXN-EDIT-FC-002 · type flip expense to income cascades correctly',
  'TXN-EDIT-FC-003 · date edit moves a transaction between budget periods',
  'TXN-EDIT-FC-004 · deleting an auto-generated debt-payment transaction restores debt balance',
  'TXN-EDIT-FC-005 · member reassignment updates per-member aggregations',
  'TXN-EDIT-FC-006 · edit is conflict-safe with a concurrent cloud update @cloud',
]);

registerBacklogSuite('§3 TXN-DEL-FC · Transaction Deletion backlog', [
  'TXN-DEL-FC-001 · hard delete confirm dialog cancels safely and confirm removes the row',
  'TXN-DEL-FC-002 · deletion updates dependent aggregates atomically',
  'TXN-DEL-FC-003 · deleting a debt-payment transaction restores debt balance',
], [
  {
    title: 'TXN-DEL-FC-004 · deleting a split anchor follows the Phase D cascade contract',
    reason: 'Blocked on Auto-Linking Phase D split-settlement anchor deletion behavior.',
  },
]);

registerBacklogSuite('§4 NWRT-FC · Net Worth backlog', [
  'NWRT-FC-003 · adding an asset increases total assets',
  'NWRT-FC-004 · adding a debt increases total liabilities',
], [
  {
    title: 'NWRT-FC-001 · expense reduces asset balance',
    reason: 'Blocked on Auto-Linking Phase A transaction-to-asset reflection.',
  },
  {
    title: 'NWRT-FC-005 · multi-currency assets convert to base currency with reflected balance updates',
    reason: 'Blocked on Auto-Linking Phase A for the transaction-reflection half of the assertion.',
  },
  {
    title: 'NWRT-FC-006 · financial ratios update when reflected balances change',
    reason: 'Blocked on Auto-Linking Phase A transaction-to-asset reflection.',
  },
]);

registerBacklogSuite('§5 BDGT-FC · Budgets backlog', [], [
  {
    title: 'BDGT-FC-008 · budget surplus follows the Phase C allocation rule',
    reason: 'Blocked on Auto-Linking Phase C budget-surplus routing.',
  },
]);

registerBacklogSuite('§6 GOAL-FC · Goals backlog', [
  'GOAL-FC-001 · creates a savings goal with target and deadline',
  'GOAL-FC-002 · manually updating goal progress persists',
  'GOAL-FC-005 · debt-type goal tracks payoff progress',
  'GOAL-FC-006 · milestone notifications fire at 50, 75, and 100 percent',
  'GOAL-FC-007 · projected completion date derives from contribution history',
  'GOAL-FC-008 · goal auto-completes at 100 percent',
], [
  {
    title: 'GOAL-FC-003 · goal linked to an asset auto-updates from transfers',
    reason: 'Blocked on Auto-Linking Phase B income and transfer crediting into linked goals.',
  },
  {
    title: 'GOAL-FC-004 · goal progress aggregates multi-source contributions',
    reason: 'Blocked on Auto-Linking Phases B and C linked-goal contribution flows.',
  },
]);

registerBacklogSuite('§7 DEBT-FC · Debt backlog', [
  'DEBT-FC-001 · creates a debt with principal rate and minimum payment',
  'DEBT-FC-003 · debt-payment transaction appears in the Transactions list',
  'DEBT-FC-004 · avalanche extra-payment cascade prioritizes highest APR',
  'DEBT-FC-005 · snowball extra-payment cascade prioritizes smallest balance',
  'DEBT-FC-006 · part-payment reduce_tenure decreases remaining months only',
  'DEBT-FC-007 · part-payment reduce_emi decreases EMI only',
  'DEBT-FC-008 · paying a debt to zero marks it inactive',
  'DEBT-FC-009 · part-payment apply_advance shifts the next due date forward',
]);

registerBacklogSuite('§8 ASSET-FC · Assets backlog', [
  'ASSET-FC-001 · creates assets across every liquidity tier',
  'ASSET-FC-002 · editing an asset updates value and lastUpdated',
  'ASSET-FC-003 · deleting an asset removes it from Net Worth and relinks transactions',
  'ASSET-FC-004 · liquidity ratio only uses liquid-tier assets',
  'ASSET-FC-005 · manual value edits create an audit trail entry',
]);

registerBacklogSuite('§9 SPLIT-FC · Splits backlog', [
  'SPLIT-FC-001 · creates an even split across participants',
  'SPLIT-FC-002 · creates an uneven split with validated share totals',
  'SPLIT-FC-003 · settling a participant removes the IOU from the Splits page',
  'SPLIT-FC-004 · paidBy external counts only your share as expense',
], [
  {
    title: 'SPLIT-FC-005 · settlement persists across reload',
    reason: 'Blocked on Auto-Linking Phase D split-settlement persistence semantics.',
  },
  {
    title: 'SPLIT-FC-006 · settlement deposit reflects in Net Worth on the selected asset',
    reason: 'Blocked on Auto-Linking Phase A reflected asset-balance updates.',
  },
]);

registerBacklogSuite('§10 RECUR-FC · Recurring backlog', [
  'RECUR-FC-001 · creates a weekly recurring schedule',
  'RECUR-FC-002 · autoConfirm generates the transaction on nextDueDate',
  'RECUR-FC-003 · reminderLeadDays fires an upcoming_bill notification',
  'RECUR-FC-004 · skip or defer one instance without affecting future schedule',
  'RECUR-FC-005 · monthly day 31 handles February correctly',
  'RECUR-FC-006 · weekly weekday schedules on the correct day',
  'RECUR-FC-007 · recurring income appears in the goal projection timeline',
]);

registerBacklogSuite('§11 NOTIF-FC · Notifications backlog', [
  'NOTIF-FC-001 · master toggle suppresses all notifications',
  'NOTIF-FC-002 · per-type toggle is honored',
  'NOTIF-FC-003 · quiet hours suppress web-push delivery while retaining the in-app notification',
  'NOTIF-FC-004 · marking a notification read updates the badge count',
  'NOTIF-FC-005 · dismissed notifications persist across reload',
  'NOTIF-FC-006 · web-push opt-in flow works when supported @cloud',
]);

registerBacklogSuite('§12 RPT-FC · Reports backlog', [
  'RPT-FC-001 · every period selector re-renders charts',
  'RPT-FC-002 · empty-state copy appears when no transactions are in range',
  'RPT-FC-003 · donut breakdown matches the summed expense category totals',
  'RPT-FC-004 · member filter narrows every chart consistently',
  'RPT-FC-005 · CSV export contains the same rows used to build the charts',
  'RPT-FC-006 · print-friendly Reports render without the sidebar',
]);

registerBacklogSuite('§13 PULSE-FC · Pulse backlog', [
  'PULSE-FC-001 · composite score matches the documented weighted sum when all components have data',
  'PULSE-FC-002 · Budget Compliance drops when over budget',
  'PULSE-FC-003 · Debt Health improves after debt payoff',
  'PULSE-FC-004 · Pulse score remains stable across reload',
  'PULSE-FC-005 · empty households yield total null with the earnable empty state',
  'PULSE-FC-006 · debt-free households renormalize the remaining components',
]);

registerBacklogSuite('§14 AUTH-FC · Auth backlog', [
  'AUTH-FC-001 · sign-up succeeds with a valid email and strong password @cloud',
  'AUTH-FC-002 · weak password is rejected with inline guidance @cloud',
  'AUTH-FC-003 · invalid email format is rejected @cloud',
  'AUTH-FC-004 · sign-in with valid credentials lands on the dashboard @cloud',
  'AUTH-FC-005 · wrong-password sign-in shows a generic error @cloud',
  'AUTH-FC-006 · sign-out clears the session and redirects to auth sign-in @cloud',
  'AUTH-FC-007 · reset-password email link sets a new password @cloud',
  'AUTH-FC-008 · accepting a household invitation joins the shared household @cloud',
  'AUTH-FC-009 · session restores from the refresh token after browser restart @cloud',
  'AUTH-FC-010 · Continue with Google button shows the coming-soon toast on Sign In, Sign Up, and Reset',
  'AUTH-FC-011 · reset page offers magic-link and Google fallback when cloud is enabled @cloud',
  'AUTH-FC-012 · reset page shows no-cloud guidance when Supabase env is absent',
]);

registerBacklogSuite('§15 PROFILE-FC · Profile backlog', [
  'PROFILE-FC-001 · editing name and email persists',
  'PROFILE-FC-002 · changing baseCurrency reformats every money display',
  'PROFILE-FC-003 · changing language and dateFormat updates the UI everywhere',
  'PROFILE-FC-004 · changing household type reveals member features',
  'PROFILE-FC-005 · changing payoff strategy reorders the payoff schedule',
  'PROFILE-FC-006 · changing extraPayment updates payoff projections',
  'PROFILE-FC-007 · theme changes persist across reload',
]);

registerBacklogSuite('§16 HH-FC · Household backlog', [
  'HH-FC-001 · creating a second household adds it to the switcher',
  'HH-FC-002 · switching households isolates data with no cross-bleed',
  'HH-FC-003 · adding a member populates the transaction member dropdown',
  'HH-FC-004 · changing a member role updates the badge',
  'HH-FC-005 · invite-by-email shows pending until accepted @cloud',
  'HH-FC-006 · viewer role enforces read-only access',
]);

registerBacklogSuite('§17 SYNC-FC · Sync backlog', [
  'SYNC-FC-001 · local edits sync to the cloud on the next push @cloud',
  'SYNC-FC-002 · cloud edits propagate to a second open session @cloud',
  'SYNC-FC-003 · optimistic concurrency rejects stale updates @cloud',
  'SYNC-FC-004 · empty cloud responses do not clobber the local cache @cloud',
  'SYNC-FC-005 · forced full resync works from Settings @cloud',
  'SYNC-FC-006 · offline edits queue and flush on reconnect @cloud',
]);

registerBacklogSuite('§18 BACKUP-FC · Backup backlog', [
  'BACKUP-FC-001 · JSON full backup round-trips every entity plus profile and rates',
  'BACKUP-FC-002 · malformed JSON import shows a clear error',
  'BACKUP-FC-003 · version-mismatched imports warn and refuse when incompatible',
  'BACKUP-FC-004 · CSV transaction export matches the active filter set',
  'BACKUP-FC-005 · balance-sheet CSV export sums to the Net Worth shown on screen',
]);

registerBacklogSuite('§19 SEARCH-FC · Search backlog', [
  'SEARCH-FC-001 · free-text search matches description note and category',
  'SEARCH-FC-002 · date-range filter narrows the transaction list',
  'SEARCH-FC-003 · type filter remains sticky across reload',
  'SEARCH-FC-004 · empty results show an actionable empty state',
]);

registerBacklogSuite('§20 ONB-FC · Onboarding backlog', [
  'ONB-FC-001 · first run shows onboarding and template selection',
  'ONB-FC-002 · family template seeds the expected categories and budgets',
  'ONB-FC-003 · primaryConcern tunes the dashboard widgets',
  'ONB-FC-004 · skipping onboarding lands on the dashboard empty state',
  'ONB-FC-005 · onboardedAt is set so onboarding never re-prompts',
]);

registerBacklogSuite('§21 PRIV-FC · Privacy backlog', [
  'PRIV-FC-001 · excluded transactions show the locked stripe and badge',
  'PRIV-FC-002 · excluded transactions are omitted from transaction-derived aggregations',
  'PRIV-FC-003 · excluded counts appear in Settings account stats',
]);

registerBacklogSuite('§22 INV-FC · Investment backlog', [
  'INV-FC-001 · investment auto-update increments linked asset value',
  'INV-FC-002 · disabling auto-update keeps the asset value flat',
  'INV-FC-003 · editing an investment transaction adjusts the asset by delta only',
]);

registerBacklogSuite('§23 FX-FC · FX backlog', [
  'FX-FC-001 · editing an exchange rate re-renders converted totals everywhere',
  'FX-FC-002 · rounding uses the target exponent without schedule drift',
  'FX-FC-003 · dinero-space sums match currency-formatted row values',
  'FX-FC-004 · cloud numeric strings parse through parseMoneyFromCloud @cloud',
  'FX-FC-005 · changing baseCurrency re-anchors every chart without precision loss',
]);

registerBacklogSuite('§24 A11Y-FC · Accessibility backlog', [
  'A11Y-FC-001 · keyboard shortcuts open and close the expected surfaces',
  'A11Y-FC-002 · modal focus trap restores focus to the trigger on close',
  'A11Y-FC-003 · aria-live announces toast notifications',
  'A11Y-FC-004 · transaction-form tab order is logical and complete',
  'A11Y-FC-005 · warm and dark themes meet AA contrast on sampled pages',
]);

registerBacklogSuite('§25 RESP-FC · Responsive backlog', [
  'RESP-FC-001 · desktop width renders the full layout',
  'RESP-FC-002 · mobile width collapses the sidebar into a hamburger menu',
  'RESP-FC-003 · very small screens stack dashboard cards into a single column',
  'RESP-FC-004 · planner and chat floating actions remain reachable on mobile',
]);

registerBacklogSuite('§26 PERF-FC · Performance backlog', [
  'PERF-FC-001 · 5000 transactions render and scroll smoothly',
  'PERF-FC-002 · period switching on a 5000-row report stays within budget',
  'PERF-FC-003 · a 360-row amortization schedule computes within budget',
  'PERF-FC-004 · the non-chart JS bundle stays under the gzipped size budget',
]);

registerBacklogSuite('§27 ERR-FC · Error resilience backlog', [
  'ERR-FC-001 · adapter network failures surface a toast and retain local cache @cloud',
  'ERR-FC-002 · schema migration failures show a recoverable error with backup link',
  'ERR-FC-003 · forceFullResync re-establishes per-entity sync sentinels @cloud',
  'ERR-FC-004 · host time-zone changes do not shift transaction dates',
  'ERR-FC-005 · localStorage quota exhaustion shows a clear recoverable error',
]);