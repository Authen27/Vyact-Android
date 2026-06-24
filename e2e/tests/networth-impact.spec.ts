// ──────────────────────────────────────────────────────────────────────────
// GOLDEN TEMPLATE — Medium (M) tier
// ──────────────────────────────────────────────────────────────────────────
//
// What "Medium" adds over Simple:
//   • Touches two pages (drives one, asserts on another)
//   • Asserts a derived value (a total, not just row presence)
//   • Uses `parseMoney()` to read formatted figures back to a number
//
// ⚠️ STATUS: NWRT-FC-002 is BLOCKED until Auto-Linking Phase A.
//
// Verified against the current build (store.ts:upsertTransaction and
// lib/accounts.ts): recording a transaction against an account does NOT
// mutate Asset.value — there is no transaction → asset reflection code path
// at all. So "income to an account raises NetWorth total assets" cannot pass
// today; it is exactly the behaviour Phase A introduces
// (docs/ROADMAP_AUTO_LINKING.md).
//
// This test is therefore `fixme` (the inventory row stays 🟡/🟠), NOT a
// weakened assertion that would green on today's no-op behaviour and give
// false confidence. When Phase A ships, delete the `.fixme`, keep the test
// ID, and update the Expected Result in TEST_CASE_INVENTORY.md.
//
// The M-tier exemplar the junior should copy is NWRT-FC-003/004 (add an
// asset/debt on the Net Worth page → the total moves) — those ARE implemented
// today. Build one of those next as the live M-tier reference.
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';
import { parseMoney } from '../pages/NetWorthPage';

const seed = seedWith({});

test.describe('§4 NWRT-FC · NetWorth Module Impact', () => {
  test.use({ seed });

  test.fixme('CON-E2E-009 · [NWRT-FC-002] income to a linked account moves NetWorth total assets', async ({
    page, transactions, txnModal, networth,
  }) => {
    // ── ARRANGE — capture the baseline total (assert the DELTA, not a constant)
    await networth.goto();
    const totalBefore = await networth.readAmount(networth.totalAssetsRow);
    expect(totalBefore).toBeGreaterThan(0);   // seed sanity

    // ── ACT — record income against the seeded 'E2E Checking' account
    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();
    await txnModal.fill({
      type:        'income',
      amount:      1_000,
      date:        '2026-05-21',
      description: 'NWRT-FC-002 Freelance',
      category:    'salary',
    });
    await txnModal.selectByValueOrText(txnModal.accountSelect, 'E2E Checking');
    await txnModal.submit();

    // ── ASSERT — total assets reflect the deposit (Phase-A behaviour)
    await networth.goto();
    await expect.poll(
      async () => networth.readAmount(networth.totalAssetsRow),
      { message: 'Total Assets should reflect the $1,000 deposit', timeout: 5_000 },
    ).toBeGreaterThanOrEqual(totalBefore + 1_000 - 0.01);
    // `page` is used by the navigation calls above.
    void page;
  });
});
