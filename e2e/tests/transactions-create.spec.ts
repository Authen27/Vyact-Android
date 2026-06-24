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
    });
    // income requires an account (ACCOUNT_REQUIRED_TYPES); the seed ships
    // 'E2E Checking' — pick it by its bare name (helper handles the prefix).
    await txnModal.selectByValueOrText(txnModal.accountSelect, 'E2E Checking');
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
      category:    'food',
      note:        'all optional fields',
    });
    await txnModal.selectByValueOrText(txnModal.accountSelect, 'E2E Checking');
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
    await txnModal.fill({
      type:        'investment',
      amount:      123.45,
      date:        '2026-05-20',
      description: 'TXN-FC-004 Invest',
      category:    'investment_in',
    });
    await txnModal.selectByValueOrText(txnModal.accountSelect, 'E2E Checking');
    await txnModal.submit();

    // The row exists and the account chip renders. NOTE: automatic
    // asset linkage (linkedAssetId set + Asset.value moved) is NOT
    // implemented pre-Phase A of the Auto-Linking roadmap, so we do NOT
    // assert it here. When Phase A ships, extend this test (same ID) to
    // assert linkedAssetId + the asset-balance delta.
    await expect(transactions.row('TXN-FC-004 Invest')).toBeVisible();
  });

  test('CON-E2E-013 · [TXN-FC-005] form rejects negative, zero, and non-numeric amounts', async ({
    transactions, txnModal,
  }) => {
    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();

    // (a) Negative and zero are caught by the app's `amount <= 0` guard:
    //     the modal stays open and no row is created.
    for (const bad of ['-100', '0']) {
      await txnModal.fill({
        type:        'expense',
        date:        '2026-05-20',
        description: `TXN-FC-005 Invalid ${bad}`,
        category:    'food',
      });
      await txnModal.amountInput.fill(bad);
      await txnModal.selectByValueOrText(txnModal.accountSelect, 'E2E Checking');
      await txnModal.submitButton.click();

      await expect(txnModal.dialog).toBeVisible();                         // blocked
      await expect(transactions.row(`TXN-FC-005 Invalid ${bad}`)).toHaveCount(0);
    }

    // (b) Non-numeric is blocked at the browser layer: a type="number" input
    //     simply refuses letters, so the field cannot even hold "abc".
    await txnModal.amountInput.fill('');
    await txnModal.amountInput.pressSequentially('abc');
    await expect(txnModal.amountInput).toHaveValue('');

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
      category:    'rent',
    });
    await txnModal.selectByValueOrText(txnModal.accountSelect, 'E2E Checking');
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
      category:    'food',
    });
    await txnModal.selectByValueOrText(txnModal.currencySelect, 'EUR');
    await txnModal.selectByValueOrText(txnModal.accountSelect, 'E2E Checking');
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
      category:    'food',
    });
    await txnModal.selectByValueOrText(txnModal.accountSelect, 'E2E Checking');

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

    test('TXN-FC-003 · transfer track creates the paired transfer rows between two accounts', async ({
      page, transactions, txnModal,
    }) => {
      const desc = 'TXN-FC-003 Transfer';

      await transactions.goto();
      await transactions.openAdd();
      await txnModal.waitOpen();

      await txnModal.trackPickButton('transfer').click();
      await expect(txnModal.trackPicker).toHaveCount(0);
      await expect(txnModal.dialog.getByLabel('Category')).toHaveCount(0);

      await txnModal.fill({
        date: '2026-05-20',
        amount: 125,
        description: desc,
      });
      await txnModal.selectByValueOrText(txnModal.dialog.getByLabel('From Account'), 'E2E Checking');
      await txnModal.selectByValueOrText(txnModal.dialog.getByLabel('To Account'), 'E2E Savings');
      await txnModal.submit();

      await expect(transactions.row(desc)).toHaveCount(2);

      const pair = await page.evaluate((description: string) => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { transactions: Array<{ description: string; type: string; category: string; note?: string; paymentMethod?: string; linkedToAssetId?: string }> } };
          __ff_store?: { getState(): { transactions: Array<{ description: string; type: string; category: string; note?: string; paymentMethod?: string; linkedToAssetId?: string }> } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        return store.getState().transactions.filter(t => t.description === description).map(t => ({
          type: t.type,
          category: t.category,
          note: t.note ?? '',
          paymentMethod: t.paymentMethod ?? '',
          linkedToAssetId: t.linkedToAssetId ?? '',
        }));
      }, desc);

      expect(pair).toHaveLength(2);
      expect(pair.map(t => t.type).sort()).toEqual(['expense', 'income']);
      expect(pair.every(t => t.category === 'transfer')).toBe(true);
      expect(pair.every(t => t.note.includes('__tg:'))).toBe(true);
    });

    test('TXN-FC-010 · track picker narrows investment categories and hides category for transfers', async ({
      transactions, txnModal,
    }) => {
      await transactions.goto();
      await transactions.openAdd();
      await txnModal.waitOpen();

      await expect(txnModal.trackPicker).toBeVisible();
      await expect(txnModal.trackPickButton('expense')).toBeVisible();
      await expect(txnModal.trackPickButton('income')).toBeVisible();
      await expect(txnModal.trackPickButton('transfer')).toBeVisible();
      await expect(txnModal.trackPickButton('investment')).toBeVisible();

      await txnModal.trackPickButton('investment').click();
      await expect(txnModal.trackFieldValue('Investment')).toBeVisible();
      await expect(txnModal.changeTrackButton).toBeVisible();

      const investmentOptions = await txnModal.categorySelect.locator('option').evaluateAll(options =>
        options.map(option => (option as HTMLOptionElement).value),
      );

      expect(investmentOptions).toEqual([
        'investment_in',
        'investment_out',
        'dividend',
        'capital_gain',
        'rebalance',
      ]);
      expect(investmentOptions).not.toContain('food');
      expect(investmentOptions).not.toContain('salary');

      await txnModal.changeTrackButton.click();
      await expect(txnModal.trackPicker).toBeVisible();
      await txnModal.trackPickButton('transfer').click();
      await expect(txnModal.trackFieldValue('Transfer')).toBeVisible();
      await expect(txnModal.dialog.getByLabel('Category')).toHaveCount(0);
      await expect(txnModal.dialog.getByLabel('To Account')).toBeVisible();
    });

    test('TXN-FC-011 · edit mode opens directly with the track locked and no picker', async ({
      transactions, txnModal,
    }) => {
      await transactions.goto();
      await transactions.openEdit('E2E Salary');
      await txnModal.waitOpen();

      await expect(txnModal.trackPicker).toHaveCount(0);
      await expect(txnModal.trackFieldValue('Income')).toBeVisible();
      await expect(txnModal.changeTrackButton).toHaveCount(0);

      await txnModal.cancel();
      await expect(transactions.row('E2E Salary')).toBeVisible();
    });

    test('TXN-FC-012 · numeric shortcuts choose each track and Escape closes the modal', async ({
      page, transactions, txnModal,
    }) => {
      const shortcuts = [
        { key: '1', label: 'Spend' },
        { key: '2', label: 'Income' },
        { key: '3', label: 'Transfer' },
        { key: '4', label: 'Investment' },
      ] as const;

      await transactions.goto();

      for (const shortcut of shortcuts) {
        await transactions.openAdd();
        await txnModal.waitOpen();
        await expect(txnModal.trackPicker).toBeVisible();

        await page.keyboard.press(shortcut.key);
        await expect(txnModal.trackFieldValue(shortcut.label)).toBeVisible();

        await page.keyboard.press('Escape');
        await txnModal.waitClosed();
      }
    });

    test('TXN-FC-013 · text time entry rejects malformed input, persists, and sorts latest first', async ({
      page, transactions, txnModal,
    }) => {
      await transactions.goto();
      await transactions.openAdd();
      await txnModal.waitOpen();

      await txnModal.trackPickButton('expense').click();
      await txnModal.fill({
        date: '2026-05-20',
        timeClock: '99:99',
        timeMeridiem: 'AM',
        amount: 20,
        description: 'TXN-FC-013 Invalid',
        category: 'food',
      });
      await txnModal.selectByValueOrText(txnModal.memberSelect, 'Test User');
      await txnModal.selectByValueOrText(txnModal.dialog.getByLabel('Account'), 'E2E Checking');
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
        await txnModal.trackPickButton('expense').click();
        await txnModal.fill({
          date: '2026-05-20',
          timeClock: entry.timeClock,
          timeMeridiem: entry.timeMeridiem,
          amount: 20,
          description: entry.description,
          category: 'food',
        });
        await txnModal.selectByValueOrText(txnModal.memberSelect, 'Test User');
        await txnModal.selectByValueOrText(txnModal.dialog.getByLabel('Account'), 'E2E Checking');
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
