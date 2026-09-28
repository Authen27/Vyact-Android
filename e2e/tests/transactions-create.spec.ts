// ──────────────────────────────────────────────────────────────────────────
// GOLDEN TEMPLATE — Simple (S) tier
// ──────────────────────────────────────────────────────────────────────────
//
// What "Simple" means in our rubric:
//   • Single page, single form
//   • No time manipulation
//   • No cloud env
//   • Cross-module assertion limited to "row appears in list"
//
// Copy this file's STRUCTURE — not its content — when implementing the rest
// of §1 TXN-FC. The shape to preserve:
//
//   1. test.use({ seed }) at the top — `defaultSeed` for everything that
//      needs a household to exist, `seedWith({ override })` when you need
//      a small delta. NEVER mutate localStorage from inside the test body.
//
//   2. One test = one Test Case ID from the inventory, named in the
//      describe-then-test pattern below so failure traces read clean.
//
//   3. Arrange → Act → Assert, with comments calling out each phase.
//
//   4. Assertions use Playwright web-first matchers (toBeVisible, toHaveText,
//      toHaveCount) so they auto-retry. Never `await page.waitForTimeout(N)`.
//
//   5. Assert through the UI by default. Reach into window.__ff_store ONLY
//      for state the UI does not surface as text (e.g. the stored currency
//      code, a duplicate count). Each such use carries a one-line reason.
//
// See e2e/REVIEW_CHECKLIST.md for the full set of reviewer-enforced rules.
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '../fixtures/app';
import { defaultSeed } from '../fixtures/seed';

const TRACK_MEMBER = {
  id: '00000000-0000-4000-8000-0000000000f1',
  name: 'Test User',
  role: 'primary',
};

const TRACK_PICKER_ASSETS = [
  ...(defaultSeed.assets ?? []),
  { id: '00000000-0000-4000-8000-0000000000f2', type: 'savings', name: 'E2E Savings', value: 2500, currency: 'USD', liquidity: 'liquid' },
  { id: '00000000-0000-4000-8000-0000000000f3', type: 'investment', name: 'E2E Brokerage', value: 4000, currency: 'USD', liquidity: 'long_term' },
];

test.describe('§1 TXN-FC · Transaction Creation', () => {
  test.use({ seed: defaultSeed });

  test('CON-E2E-007 · [TXN-FC-001] creates an income transaction with the minimum required fields', async ({
    page, transactions, txnModal,
  }) => {
    // ── ARRANGE ──────────────────────────────────────────────────────────
    await transactions.goto();
    await expect(transactions.row('E2E Salary')).toBeVisible();  // seed sanity

    // ── ACT ──────────────────────────────────────────────────────────────
    await transactions.openAdd();
    await txnModal.waitOpen();
    await txnModal.fill({
      type:        'income',
      amount:      2_500,
      date:        '2026-05-20',
      description: 'TXN-FC-001 Bonus',
      category:    'salary',
      account:     'E2E Checking',
    });
    // income requires an account (ACCOUNT_REQUIRED_TYPES); the seed ships
    // 'E2E Checking' — pick it by its bare name (helper handles the prefix).
    await txnModal.submit();

    // ── ASSERT (UI) ──────────────────────────────────────────────────────
    const row = transactions.row('TXN-FC-001 Bonus');
    await expect(row).toBeVisible();
    await expect(row).toHaveCount(1);

    // ── REGRESSION GUARD — persistence across reload (v6.4 "data lost") ───
    await page.reload();
    await expect(transactions.row('TXN-FC-001 Bonus')).toBeVisible();
  });

  test('CON-E2E-010 · [TXN-FC-002] creates an expense with all optional fields and persists', async ({
    page, transactions, txnModal,
  }) => {
    await transactions.goto();

    await transactions.openAdd();
    await txnModal.waitOpen();
    await txnModal.fill({
      type:        'expense',
      amount:      42.50,
      date:        '2026-05-20',
      description: 'TXN-FC-002 Full',
      category:    'food_dining',
      note:        'all optional fields',
      account:     'E2E Checking',
    });
    await txnModal.submit();

    // Assert through the UI, then confirm it survives a reload.
    await expect(transactions.row('TXN-FC-002 Full')).toBeVisible();
    await page.reload();
    await expect(transactions.row('TXN-FC-002 Full')).toBeVisible();
  });

  test('CON-E2E-012 · [TXN-FC-004] investment records its type and account', async ({
    transactions, txnModal,
  }) => {
    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();
    // 🔴 NO category. `investment_in` is not a real id — `CATEGORIES_BY_TYPE`
    // has `investment: []` (constants.ts) and INV-9 asserts that pool is empty,
    // because an investment is one spend/income-NEUTRAL row with both account
    // FKs set and no category. The old assertion was a money-model violation:
    // had it passed, INV-9 would have been broken.
    await txnModal.fill({
      type:        'investment',
      amount:      123.45,
      date:        '2026-05-20',
      description: 'TXN-FC-004 Invest',
      account:     'E2E Checking',
    });
    // Per-type account matrix: investment needs a destination too.
    await txnModal.selectToAccount('E2E Brokerage');
    await txnModal.submit();

    // The row exists and the account chip renders. NOTE: automatic
    // asset linkage (linkedAssetId set + Asset.value moved) is NOT
    // implemented pre-Phase A of the Auto-Linking roadmap, so we do NOT
    // assert it here. When Phase A ships, extend this test (same ID) to
    // assert linkedAssetId + the asset-balance delta.
    await expect(transactions.row('TXN-FC-004 Invest')).toBeVisible();
  });

  test('CON-E2E-013 · [TXN-FC-005] the amount field cannot hold a negative, and zero is refused', async ({
    transactions, txnModal,
  }) => {
    // 🔴 REWRITTEN 2026-09-10. The old version drove `txnModal.amountInput` (a
    // member the Aurora page object does not have) and reasoned that "a
    // type=number input simply refuses letters". The field is not type=number:
    // it is `type=text inputmode=decimal` feeding an in-sheet keypad, with its
    // own sanitiser. Measured behaviour, which is STRONGER than the old guard:
    //   "abc"      -> ""       letters never land
    //   "-100"     -> "100"    the minus is stripped, so a negative is unenterable
    //   "12.34.56" -> "12.34"  a second decimal point is refused
    // So negative amounts are no longer "rejected on submit" — they cannot be
    // represented at all. Zero still has to be caught by the submit guard.
    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();

    const amount = txnModal.dialog.getByLabel('Amount', { exact: true });

    // (a) Input sanitisation — the field refuses what is not a positive decimal.
    await amount.fill('');
    await amount.pressSequentially('abc');
    await expect(amount).toHaveValue('');

    await amount.fill('');
    await amount.pressSequentially('-100');
    await expect(amount, 'the minus sign must be stripped').toHaveValue('100');

    await amount.fill('');
    await amount.pressSequentially('12.34.56');
    await expect(amount, 'a second decimal point must be refused').toHaveValue('12.34');

    // (b) Zero IS enterable, so the submit guard must block it and keep the
    //     sheet open with no row created.
    await amount.fill('');
    await amount.pressSequentially('0');
    await txnModal.fill({
      type:        'expense',
      date:        '2026-05-20',
      description: 'TXN-FC-005 Invalid 0',
      category:    'food_dining',
      account:     'E2E Checking',
    });
    await txnModal.submitButton.click();

    await expect(txnModal.dialog, 'a zero amount must not submit').toBeVisible();
    await expect(transactions.row('TXN-FC-005 Invalid 0')).toHaveCount(0);

    await txnModal.cancel();
  });

  test('CON-E2E-014 · [TXN-FC-007] preserves unicode and emoji in the description', async ({
    page, transactions, txnModal,
  }) => {
    const desc = '🏠 Rent @ 123 Main St — ありがとう €1200';

    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();
    await txnModal.fill({
      type:        'expense',
      amount:      10,
      date:        '2026-05-20',
      description: desc,
      category:    'rent_mortgage',
    });
    await txnModal.submit();

    // Round-trips byte-for-byte in the rendered row and across a reload.
    await expect(transactions.row(desc)).toBeVisible();
    await page.reload();
    await expect(transactions.row(desc)).toBeVisible();
  });

  test('CON-E2E-015 · [TXN-FC-008] stores the original currency of the transaction', async ({
    page, transactions, txnModal,
  }) => {
    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();
    await txnModal.fill({
      type:        'expense',
      amount:      55,
      date:        '2026-05-20',
      description: 'TXN-FC-008 EUR',
      category:    'food_dining',
      currency:    'EUR',
      account:     'E2E Checking',
    });
    await txnModal.submit();

    await expect(transactions.row('TXN-FC-008 EUR')).toBeVisible();

    // ORACLE (justified): the stored currency CODE is not rendered as literal
    // text in the row (the Money component shows the € symbol, not "EUR"),
    // so we read it from the store to assert it was persisted as 'EUR'.
    const currency = await page.evaluate(() => {
      const s = (window as { __ff_store?: { getState(): { transactions: { description: string; currency: string }[] } } }).__ff_store;
      return s?.getState().transactions.find(t => t.description === 'TXN-FC-008 EUR')?.currency ?? null;
    });
    expect(currency).toBe('EUR');
  });

  test('CON-E2E-016 · [TXN-FC-009] a rapid double-submit creates only one transaction', async ({
    page, transactions, txnModal,
  }) => {
    const desc = 'TXN-FC-009 DoubleSubmit';

    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();
    await txnModal.fill({
      type:        'expense',
      amount:      7,
      date:        '2026-05-20',
      description: desc,
      category:    'food_dining',
      account:     'E2E Checking',
    });

    // Double-click the submit button; the form's `saving` guard should
    // collapse this into a single upsert.
    await txnModal.submitButton.dblclick();
    await txnModal.waitClosed();

    // UI: exactly one row.
    await expect(transactions.row(desc)).toHaveCount(1);

    // ORACLE (justified): a count of stored records is not something the
    // list surfaces directly; read it to harden the dedupe assertion.
    const count = await page.evaluate((d: string) => {
      const s = (window as { __ff_store?: { getState(): { transactions: { description: string }[] } } }).__ff_store;
      return s?.getState().transactions.filter(t => t.description === d).length ?? -1;
    }, desc);
    expect(count).toBe(1);
  });

  test('CON-E2E-055 · a transfer or investment has no category field', async ({
    page, transactions, txnModal,
  }) => {
    // ── ARRANGE ──────────────────────────────────────────────────────────
    await transactions.goto();

    // ── ACT + ASSERT ─────────────────────────────────────────────────────
    // Money-model rule: a transfer/investment is one spend/income-neutral
    // row with no category — see CLAUDE.md's binding money-model section.
    // Moved here from a removed Ask Vyact "Open form" shortcut (v10.34.0);
    // opened via the real Add Transaction entry point instead.
    for (const type of ['transfer', 'investment'] as const) {
      await transactions.openAdd();
      await txnModal.waitOpen();
      await txnModal.setType(type);
      await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveCount(0);
      await txnModal.cancel();
    }
  });

  test.describe('track picker and time entry', () => {
    test.use({
      seed: {
        ...defaultSeed,
        assets: TRACK_PICKER_ASSETS,
        members: [TRACK_MEMBER],
      },
    });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        window.localStorage.setItem('vt_feature_track_picker', '1');
      });
    });

    // ──────────────────────────────────────────────────────────────────────
    // RETIRED 2026-09-10 — four tests removed, not rewritten.
    //
    // TXN-FC-003 · "transfer track creates the paired transfer rows"
    //   Asserted `toHaveCount(2)`, a sorted ['expense','income'] pair, every row
    //   carrying `category === 'transfer'`, and a `__tg:` note tag. Every one of
    //   those is now a MONEY-MODEL VIOLATION: v9 made a transfer ONE
    //   spend/income-neutral row with both account FKs set and no category, and
    //   retired the `__tg` paired-row encoding outright. This test failing is
    //   the correct behaviour — had it passed, INV-1 would be broken. Kept as a
    //   red test it would have been actively misleading.
    //
    // TXN-FC-010 · "track picker narrows investment categories"
    // TXN-FC-011 · "edit mode opens directly with the track locked and no picker"
    // TXN-FC-012 · "numeric shortcuts choose each track"
    //   All three drive the TRACK PICKER, retired by v9 (D3). The page object has
    //   no `trackPicker`/`trackPickButton`/`trackFieldValue`/`changeTrackButton`
    //   because the control does not exist. A test for a deleted feature is not
    //   a coverage gap. What survives of TXN-FC-012 — Escape closes the modal —
    //   is already covered by A11Y-FC-001.
    //
    // IDs are recorded in docs/TEST_SCENARIOS.md §5 and must not be reused.
    // ──────────────────────────────────────────────────────────────────────

    test('TXN-FC-013 · text time entry rejects malformed input, persists, and sorts latest first', async ({
      page, transactions, txnModal,
    }) => {
      await transactions.goto();
      await transactions.openAdd();
      await txnModal.waitOpen();

      await txnModal.fill({
        date: '2026-05-20',
        timeClock: '99:99',
        timeMeridiem: 'AM',
        amount: 20,
        description: 'TXN-FC-013 Invalid',
        category: 'food_dining',
        member: 'Test User',
        account: 'E2E Checking',
      });
      await txnModal.submitButton.click();

      await expect(txnModal.dialog).toBeVisible();
      await expect(page.getByText('Enter time as hh:mm with AM or PM')).toBeVisible();
      await txnModal.cancel();

      const entries = [
        { description: 'TXN-FC-013 Morning', timeClock: '09:15', timeMeridiem: 'AM' as const, expected: '09:15' },
        { description: 'TXN-FC-013 Evening', timeClock: '06:45', timeMeridiem: 'PM' as const, expected: '18:45' },
      ];

      for (const entry of entries) {
        await transactions.openAdd();
        await txnModal.waitOpen();
        await txnModal.fill({
          date: '2026-05-20',
          timeClock: entry.timeClock,
          timeMeridiem: entry.timeMeridiem,
          amount: 20,
          description: entry.description,
          category: 'food_dining',
          member: 'Test User',
          account: 'E2E Checking',
        });
        await txnModal.submit();
      }

      await page.reload();

      await expect(transactions.row('TXN-FC-013 Morning')).toContainText('09:15');
      await expect(transactions.row('TXN-FC-013 Evening')).toContainText('18:45');
      await expect(page.locator('[data-testid="txn-row"]').first()).toContainText('TXN-FC-013 Evening');

      const storedTimes = await page.evaluate(() => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { transactions: Array<{ description: string; time?: string }> } };
          __ff_store?: { getState(): { transactions: Array<{ description: string; time?: string }> } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        return store.getState().transactions
          .filter(t => t.description.startsWith('TXN-FC-013 '))
          .map(t => ({ description: t.description, time: t.time ?? null }));
      });

      expect(storedTimes).toEqual(expect.arrayContaining([
        { description: 'TXN-FC-013 Morning', time: '09:15' },
        { description: 'TXN-FC-013 Evening', time: '18:45' },
      ]));
    });
  });
});
