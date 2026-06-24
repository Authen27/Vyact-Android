import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';

const SEARCH_MEMBER = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Search Member',
  role: 'primary',
};

const ALT_MEMBER = {
  id: '00000000-0000-4000-8000-0000000000ad',
  name: 'Alt Member',
  role: 'partner',
};

const SEARCH_TXNS = [
  {
    id: '00000000-0000-4000-8000-0000000000ab',
    type: 'expense',
    amount: 25,
    currency: 'USD',
    date: '2026-05-10',
    description: 'SEARCH-FC-001 Description',
    category: 'food',
    note: 'search-note-token',
    memberId: SEARCH_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000ac',
    type: 'expense',
    amount: 40,
    currency: 'USD',
    date: '2026-05-11',
    description: 'SEARCH-FC-001 Transport',
    category: 'transport',
    memberId: SEARCH_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000ae',
    type: 'income',
    amount: 4000,
    currency: 'USD',
    date: '2026-04-14',
    description: 'SEARCH-FC-002 Salary',
    category: 'salary',
    memberId: ALT_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000af',
    type: 'investment',
    amount: 300,
    currency: 'USD',
    date: '2026-05-10',
    description: 'SEARCH-FC-002 Brokerage',
    category: 'investment_in',
    memberId: ALT_MEMBER.id,
  },
];

test.describe('§19 SEARCH-FC · Search and empty-state behavior', () => {
  test.use({ seed: seedWith({ transactions: SEARCH_TXNS, members: [SEARCH_MEMBER, ALT_MEMBER] }) });

  test('SEARCH-FC-001 · free-text search matches description, note, and category', async ({
    page, transactions,
  }) => {
    await transactions.goto();
    const search = page.getByPlaceholder('Search…');

    await search.fill('Description');
    await expect(transactions.row('SEARCH-FC-001 Description')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-001 Transport')).toHaveCount(0);

    await search.fill('search-note-token');
    await expect(transactions.row('SEARCH-FC-001 Description')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-001 Transport')).toHaveCount(0);

    await search.fill('transport');
    await expect(transactions.row('SEARCH-FC-001 Transport')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-001 Description')).toHaveCount(0);
  });

  test('SEARCH-FC-004 · empty results show an actionable empty state', async ({
    page, transactions,
  }) => {
    await transactions.goto();
    await page.getByPlaceholder('Search…').fill('no-match-token');

    await expect(page.getByText('No transactions found')).toBeVisible();
    await expect(page.getByPlaceholder('Search…')).toBeVisible();
  });

  test('SEARCH-FC-002 · structured filters narrow the transactions list', async ({
    page, transactions,
  }) => {
    await transactions.goto();
    const filters = page.getByRole('combobox');

    await filters.nth(0).selectOption('income');
    await expect(transactions.row('SEARCH-FC-002 Salary')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-001 Description')).toHaveCount(0);
    await expect(transactions.row('SEARCH-FC-002 Brokerage')).toHaveCount(0);

    await filters.nth(0).selectOption('all');
    await filters.nth(1).selectOption('food');
    await expect(transactions.row('SEARCH-FC-001 Description')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-001 Transport')).toHaveCount(0);

    await filters.nth(1).selectOption('all');
    await filters.nth(2).selectOption('2026-04');
    await expect(transactions.row('SEARCH-FC-002 Salary')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-001 Description')).toHaveCount(0);

    await filters.nth(2).selectOption('all');
    await filters.nth(3).selectOption(ALT_MEMBER.id);
    await expect(transactions.row('SEARCH-FC-002 Salary')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-002 Brokerage')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-001 Description')).toHaveCount(0);
  });

  test('SEARCH-FC-003 · calendar day selection narrows the list and surfaces a clearable date chip', async ({
    page, transactions,
  }) => {
    await transactions.goto();
    await transactions.calendarToggle.click();

    await page.getByTitle(/2026-05-10/).click();
    await expect(page.getByText('Showing May 10, 2026')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-001 Description')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-002 Brokerage')).toBeVisible();
    await expect(transactions.row('SEARCH-FC-001 Transport')).toHaveCount(0);

    await page.getByLabel('Clear date filter').click();
    await expect(page.getByText('Showing May 10, 2026')).toHaveCount(0);
    await expect(transactions.row('SEARCH-FC-001 Transport')).toBeVisible();
  });
});