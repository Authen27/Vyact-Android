// ──────────────────────────────────────────────────────────────────────────
// GOLDEN TEMPLATE — Medium (M) tier
// ──────────────────────────────────────────────────────────────────────────
//
// What "Medium" adds over Simple:
//   • Touches two pages (drives one, asserts on another)
//   • Asserts a derived value (a total, not just row presence)
//   • Uses `parseMoney()` to read formatted figures back to a number
//
// STATUS: NWRT-FC-002 runs since T5b (v10.121.0; audit XC-ARC-08).
//
// It was `fixme` because the local-only build (Lane A) still picked the transaction form's accounts
// through the retired Money Map flag, whose legacy list offered the "E2E Checking" ASSET: an entry there
// moved no account, so Net Worth could not move. Every build now lists the household's ACCOUNTS, and an
// account's live balance is in Net Worth (lib/accountBalance.ts liveAssetRows), so a deposit raises
// total assets. The assertion is unchanged: it reads the delta, not a constant.
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

  test('CON-E2E-009 · [NWRT-FC-002] income to a linked account moves NetWorth total assets', async ({
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
    await txnModal.selectAccount('E2E Checking');
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
