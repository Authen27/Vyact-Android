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


registerBacklogSuite('§1 TXN-FC · Transaction Creation backlog', [
  'TXN-FC-006 · future-date policy matches the decided product rule',
]);



registerBacklogSuite('§4 NWRT-FC · Net Worth backlog', [
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


registerBacklogSuite('§7 DEBT-FC · Debt backlog', [
  'DEBT-FC-004 · avalanche extra-payment cascade prioritizes highest APR',
  'DEBT-FC-005 · snowball extra-payment cascade prioritizes smallest balance',
  'DEBT-FC-008 · paying a debt to zero marks it inactive',
]);

registerBacklogSuite('§8 ASSET-FC · Assets backlog', [
  'ASSET-FC-003 · deleting an asset removes it from Net Worth and relinks transactions',
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
  'RPT-FC-004 · member filter narrows every chart consistently',
  'RPT-FC-005 · CSV export contains the same rows used to build the charts',
  'RPT-FC-006 · print-friendly Reports render without the sidebar',
]);

registerBacklogSuite('§13 PULSE-FC · Pulse backlog', [
  'PULSE-FC-001 · composite score matches the documented weighted sum when all components have data',
  'PULSE-FC-002 · Budget Compliance drops when over budget',
  'PULSE-FC-003 · Debt Health improves after debt payoff',
  'PULSE-FC-004 · Pulse score remains stable across reload',
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
  'AUTH-FC-011 · reset page offers magic-link and Google fallback when cloud is enabled @cloud',
]);


registerBacklogSuite('§16 HH-FC · Household backlog', [
  'HH-FC-001 · creating a second household adds it to the switcher',
  'HH-FC-002 · switching households isolates data with no cross-bleed',
  'HH-FC-003 · adding a member populates the transaction member dropdown',
  'HH-FC-004 · changing a member role updates the badge',
  'HH-FC-005 · invite-by-email shows pending until accepted @cloud',
  'HH-FC-006 · viewer role enforces read-only access',
  'HH-FC-007 · create household from the /households page @cloud',
  'HH-FC-008 · owner deletes a household from Danger Zone @cloud',
  'HH-REG-001 · deleting a household with existing activity never hits the activity_log FK violation @cloud',
  'HH-REG-002 · a failed household creation surfaces an error toast instead of silently doing nothing @cloud',
]);

registerBacklogSuite('§17 SYNC-FC · Sync backlog', [
  'SYNC-FC-001 · local edits sync to the cloud on the next push @cloud',
  'SYNC-FC-002 · cloud edits propagate to a second open session @cloud',
  'SYNC-FC-003 · optimistic concurrency rejects stale updates @cloud',
  'SYNC-FC-004 · empty cloud responses do not clobber the local cache @cloud',
  'SYNC-FC-005 · forced full resync works from Settings @cloud',
  'SYNC-FC-006 · offline edits queue and flush on reconnect @cloud',
]);



registerBacklogSuite('§20 ONB-FC · Onboarding backlog', [
  'ONB-FC-001 · first run shows onboarding and template selection',
]);

registerBacklogSuite('§21 PRIV-FC · Privacy backlog', [
  'PRIV-FC-003 · excluded counts appear in Settings account stats',
]);

registerBacklogSuite('§22 INV-FC · Investment backlog', [
  'INV-FC-001 · investment auto-update increments linked asset value',
  'INV-FC-002 · disabling auto-update keeps the asset value flat',
  'INV-FC-003 · editing an investment transaction adjusts the asset by delta only',
]);

registerBacklogSuite('§23 FX-FC · FX backlog', [
  'FX-FC-002 · rounding uses the target exponent without schedule drift',
  'FX-FC-003 · dinero-space sums match currency-formatted row values',
  'FX-FC-004 · cloud numeric strings parse through parseMoneyFromCloud @cloud',
]);


registerBacklogSuite('§25 RESP-FC · Responsive backlog', [
  'RESP-FC-003 · very small screens stack dashboard cards into a single column',
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