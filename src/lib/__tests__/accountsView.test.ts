import { describe, expect, it } from 'vitest';
import type { Account } from '../../types';
import {
  accountGroup, accountsSummary, cardFigures, hasDependencies, lastReconciledAt, localAccountDependencies,
  moveDestinations, nextDueDate, openingBalanceForCard, staleDays, statementWindow, STALE_AFTER_DAYS,
} from '../accountsView';
import type { RecurringSchedule, Transaction } from '../../types';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const acct = (over: Partial<Account>): Account =>
  ({ id: crypto.randomUUID(), kind: 'bank', name: 'A', currency: 'INR', ...over }) as Account;

describe('Accounts R2 — card figures are derived from the ledger, never stored', () => {
  it('the design example: ₹1,50,000 limit with ₹18,400 owed leaves ₹1,31,600 free at 12%', () => {
    const f = cardFigures(150_000, -18_400)!;
    expect(f).toMatchObject({ limit: 150_000, outstanding: 18_400, available: 131_600 });
    expect(Math.round(f.utilisation * 100)).toBe(12);
  });

  it('the two limits typed when adding a card seed an opening balance that reproduces them', () => {
    const opening = openingBalanceForCard(150_000, 131_600);
    expect(opening).toBe(-18_400);
    expect(cardFigures(150_000, opening)!.available).toBe(131_600);
  });

  it('an overpaid card owes nothing and has more than its limit free', () => {
    expect(cardFigures(50_000, 500)).toMatchObject({ outstanding: 0, available: 50_500, utilisation: 0 });
  });

  it('over the limit, utilisation exceeds 100% instead of being clamped into a lie', () => {
    expect(cardFigures(10_000, -12_000)!.utilisation).toBeCloseTo(1.2, 10);
  });

  it('no limit recorded means no card figures, not zeroes', () => {
    expect(cardFigures(undefined, -100)).toBeNull();
    expect(cardFigures(0, -100)).toBeNull();
  });
});

describe('Accounts R2 — statement window and due date', () => {
  it('cycle on the 11th: before the 11th the window started last month', () => {
    expect(statementWindow(11, at('2026-09-10'))).toEqual({ start: '2026-08-11', end: '2026-09-10' });
  });

  it('cycle on the 11th: from the 11th a new window starts', () => {
    expect(statementWindow(11, at('2026-09-11'))).toEqual({ start: '2026-09-11', end: '2026-10-10' });
  });

  it('a cycle day past the end of a short month clamps to its last day', () => {
    expect(statementWindow(31, at('2026-02-28'))).toEqual({ start: '2026-02-28', end: '2026-03-30' });
    expect(statementWindow(31, at('2028-02-29'))).toEqual({ start: '2028-02-29', end: '2028-03-30' });
  });

  it('the window crosses the year boundary', () => {
    expect(statementWindow(15, at('2027-01-03'))).toEqual({ start: '2026-12-15', end: '2027-01-14' });
  });

  it('the due date is today if today is the day, otherwise the next occurrence', () => {
    expect(nextDueDate(5, at('2026-09-05'))).toBe('2026-09-05');
    expect(nextDueDate(5, at('2026-09-10'))).toBe('2026-10-05');
    expect(nextDueDate(31, at('2026-02-10'))).toBe('2026-02-28');
    expect(nextDueDate(5, at('2026-12-20'))).toBe('2027-01-05');
  });
});

describe('Accounts R2 — "not reconciled in N days"', () => {
  const now = at('2026-09-10');

  it('an account reconciled 41 days ago is stale by 41 days', () => {
    expect(staleDays(acct({ lastReconciledAt: '2026-07-31T12:00:00Z' }), now)).toBe(41);
  });

  it('a card added three days ago and never reconciled is not stale', () => {
    expect(staleDays(acct({ createdAt: '2026-09-07T12:00:00Z' }), now)).toBeNull();
  });

  it('exactly at the threshold is still fresh; one day past is stale', () => {
    expect(staleDays(acct({ lastReconciledAt: '2026-08-11T12:00:00Z' }), now)).toBeNull();
    expect(STALE_AFTER_DAYS).toBe(30);
    expect(staleDays(acct({ lastReconciledAt: '2026-08-10T12:00:00Z' }), now)).toBe(31);
  });

  it('without a stamp, the latest reconciliation log entry is used', () => {
    const a = acct({ reconciliationLog: [
      { at: '2026-06-01T00:00:00Z', delta: 5, kind: 'bank', stated_value: 10 },
      { at: '2026-08-20T00:00:00Z', delta: -2, kind: 'bank', stated_value: 8 },
    ] });
    expect(lastReconciledAt(a)).toBe('2026-08-20T00:00:00Z');
    expect(staleDays(a, now)).toBeNull();
  });
});

describe('Accounts R2 — grouping and Spendable now', () => {
  it('Bank holds bank and Cash in Hand; cards group alone; loans and investments live elsewhere', () => {
    expect(accountGroup({ kind: 'bank' })).toBe('bank');
    expect(accountGroup({ kind: 'cash' })).toBe('bank');
    expect(accountGroup({ kind: 'credit_card' })).toBe('credit_card');
    expect(accountGroup({ kind: 'loan' })).toBeNull();
    expect(accountGroup({ kind: 'investment' })).toBeNull();
  });

  it('the design example: ₹1,31,400 in the bank, ₹18,400 on cards → ₹1,13,000 spendable', () => {
    const hdfc = acct({ name: 'HDFC savings' });
    const icici = acct({ name: 'ICICI current' });
    const card = acct({ kind: 'credit_card', name: 'Regalia' });
    const balances = new Map([[hdfc.id, 124_000], [icici.id, 7_400], [card.id, -18_400]]);
    expect(accountsSummary([hdfc, icici, card], a => balances.get(a.id)!))
      .toEqual({ cashAvailable: 131_400, cardOutstanding: 18_400, spendableNow: 113_000 });
  });

  it('archived accounts, loans and investments never reach the summary; an overpaid card is not cash', () => {
    const live = acct({});
    const archived = acct({ isArchived: true });
    const loan = acct({ kind: 'loan' });
    const invest = acct({ kind: 'investment' });
    const overpaid = acct({ kind: 'credit_card' });
    const balances = new Map([[live.id, 1_000], [archived.id, 9_999], [loan.id, -50_000], [invest.id, 70_000], [overpaid.id, 300]]);
    expect(accountsSummary([live, archived, loan, invest, overpaid], a => balances.get(a.id)!))
      .toEqual({ cashAvailable: 1_000, cardOutstanding: 0, spendableNow: 1_000 });
  });
});

describe('Accounts R2 — delete guard', () => {
  const txn = (over: Partial<Transaction>): Transaction =>
    ({ id: crypto.randomUUID(), type: 'expense', amount: 100, currency: 'INR', date: '2026-08-01', description: '', category: 'utilities', ...over }) as Transaction;

  it('an account nothing refers to has no dependencies — permanent delete is safe', () => {
    const d = localAccountDependencies('acct-1', [txn({ accountId: 'other' })], []);
    expect(d.transactions.count).toBe(0);
    expect(hasDependencies(d)).toBe(false);
  });

  it('itemises history the way the RPC does: count, total, date range, busiest groups first', () => {
    const txns = [
      txn({ accountId: 'a', description: 'Rent', amount: 12_000, date: '2026-02-12' }),
      txn({ accountId: 'a', description: 'Rent', amount: 12_000, date: '2026-03-12' }),
      txn({ accountId: 'a', description: 'BESCOM', amount: 3_200, date: '2026-04-02' }),
      txn({ type: 'income', toAccountId: 'a', description: '', category: 'salary', amount: 50_000, date: '2026-08-28' }),
    ];
    const d = localAccountDependencies('a', txns, []);
    expect(d.transactions).toMatchObject({ count: 4, total: 77_200, firstDate: '2026-02-12', lastDate: '2026-08-28' });
    expect(d.transactions.groups[0]).toEqual({ label: 'Rent', count: 2, total: 24_000 });
    expect(d.transactions.groups.map(g => g.label)).toContain('salary');
    expect(hasDependencies(d)).toBe(true);
  });

  it('a recurring schedule alone is enough to block permanent delete', () => {
    const schedule = { id: 's1', transactionTemplate: { type: 'expense', amount: 10, currency: 'INR', description: 'Netflix', category: 'entertainment', accountId: 'a' } } as unknown as RecurringSchedule;
    const d = localAccountDependencies('a', [], [schedule]);
    expect(d.recurring).toEqual([{ id: 's1', label: 'Netflix' }]);
    expect(hasDependencies(d)).toBe(true);
  });

  it('history may only move within its group, never to itself or an archived account', () => {
    const bank = acct({ id: 'bank' });
    const cash = acct({ id: 'cash', kind: 'cash' });
    const otherBank = acct({ id: 'bank2' });
    const archivedBank = acct({ id: 'bank3', isArchived: true });
    const card = acct({ id: 'card', kind: 'credit_card' });
    const card2 = acct({ id: 'card2', kind: 'credit_card' });
    const invest = acct({ id: 'inv', kind: 'investment' });
    const all = [bank, cash, otherBank, archivedBank, card, card2, invest];
    expect(moveDestinations(bank, all).map(a => a.id)).toEqual(['cash', 'bank2']);
    expect(moveDestinations(card, all).map(a => a.id)).toEqual(['card2']);
    expect(moveDestinations(invest, all)).toEqual([]);
  });
});
