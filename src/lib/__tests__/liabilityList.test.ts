import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeNetWorth } from '../netWorth';
import { liabilityList, liabilityRowLabel } from '../liabilityList';
import type { Account, Debt } from '../../types';

describe('Net Worth liabilities list (W6, audit FE-UIC-06)', () => {
  const card: Account = { id: 'card', kind: 'credit_card', name: 'HDFC card', currency: 'INR', openingBalance: -23_990, isDefault: false, isArchived: false } as Account;
  const loanAcct: Account = { id: 'loanacct', kind: 'loan', name: 'Home loan', currency: 'INR', openingBalance: -10_00_000, debtId: 'home', isDefault: false, isArchived: false } as Account;
  const paidCard: Account = { id: 'paid', kind: 'credit_card', name: 'Old card', currency: 'INR', openingBalance: 0, isDefault: false, isArchived: false } as Account;
  const home: Debt = { id: 'home', type: 'mortgage', name: 'Home loan', principal: 12_00_000, currentBalance: 10_00_000, interestRate: 8.5, minimumPayment: 9_000, currency: 'INR' } as Debt;
  const friend: Debt = { id: 'friend', type: 'personal', name: 'From Ravi', principal: 5_000, currentBalance: 5_000, interestRate: 0, minimumPayment: 0, currency: 'INR' } as Debt;
  const lent: Debt = { id: 'lent', type: 'personal', name: 'Lent to Asha', principal: 900, currentBalance: 900, interestRate: 0, minimumPayment: 0, currency: 'INR', direction: 'owed_to_me' } as Debt;

  it('W6-UIC06-001 · the list is the projection\'s rows: card and loan accounts and unlinked debts, summing to Total Liabilities', () => {
    const p = computeNetWorth({ assets: [], accounts: [card, loanAcct, paidCard], debts: [home, friend, lent], transactions: [] }, 'INR', {});
    const rows = liabilityList(p);
    expect(rows.map(r => r.name)).toEqual(['HDFC card', 'Home loan', 'From Ravi']);   // no zero card, no receivable, the loan once
    expect(rows.reduce((s, r) => s + r.value, 0)).toBe(p.totalLiabilities);
    expect(p.totalLiabilities).toBe(10_28_990);
  });

  it('W6-UIC06-002 · a card says it is managed in Accounts; a loan account shows its debt\'s terms; a card-only household is not "no debts"', () => {
    const p = computeNetWorth({ assets: [], accounts: [card, loanAcct], debts: [home], transactions: [] }, 'INR', {});
    const [cardRow, loanRow] = liabilityList(p);
    expect(liabilityRowLabel(cardRow, [home])).toEqual({ icon: '💳', sub: 'Credit card · managed in Accounts' });
    expect(liabilityRowLabel(loanRow, [home]).sub).toMatch(/8\.5% APR$/);
    const cardOnly = computeNetWorth({ assets: [], accounts: [card], debts: [], transactions: [] }, 'INR', {});
    expect(liabilityList(cardOnly)).toHaveLength(1);
    const page = readFileSync(resolve(__dirname, '../../pages/NetWorth.tsx'), 'utf8');
    expect(page).toMatch(/liabilityList\.length === 0 \?/);
    expect(page).not.toMatch(/No debts tracked/);
  });
});
