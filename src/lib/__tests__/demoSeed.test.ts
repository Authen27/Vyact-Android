// v10.53.0 (master to-do #68) — the first-run demo household, pinned on awkward days:
// the 1st of a month (nothing may be dated after today) and December (due dates must
// roll into January, not "<year>-13-…").
import { describe, expect, it } from 'vitest';
import { buildSeed, demoDate, nextOnDay } from '../seed';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('first-run demo household', () => {
  it('CON-UNIT-DEMO-001 · nothing is dated after today, and every due date is a real future date (1st of the month, December)', () => {
    for (const now of [new Date(2026, 9, 1, 9), new Date(2026, 11, 20, 9), new Date(2027, 0, 31, 9), new Date(2026, 1, 28, 9)]) {
      const today = ymd(now);
      const seed = buildSeed(now);
      for (const t of seed.transactions) expect(t.date <= today, `${t.description} ${t.date} > ${today}`).toBe(true);
      const dues = [...seed.debts.map(d => d.dueDate!), ...seed.recurring.map(r => r.nextDueDate)];
      for (const due of dues) {
        expect(due).toMatch(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
        expect(due > today, `${due} should be after ${today}`).toBe(true);
      }
    }
    expect(nextOnDay(new Date(2026, 11, 20, 9), 15)).toBe('2027-01-15');   // the old "2026-13-15"
    expect(demoDate(new Date(2026, 2, 31), 1, 31)).toBe('2026-02-28');      // clamped to February
  });

  it('CON-UNIT-DEMO-002 · uses the current model: allocations within one month budget, accounts on every entry, who added it, money owed, an EMI', () => {
    const now = new Date(2026, 9, 20, 9);
    const seed = buildSeed(now);
    expect(seed.members.map(m => m.name)).toEqual(['Alex', 'Sam']);
    const memberIds = new Set(seed.members.map(m => m.id));
    const accountIds = new Set(seed.accounts.map(a => a.id));

    expect(seed.budgets).toHaveLength(1);
    const budget = seed.budgets[0];
    expect(budget).toMatchObject({ scope: 'month', periodYear: 2026, periodMonth: 10, periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    expect(seed.budgetAllocations.every(a => a.budgetId === budget.id)).toBe(true);
    expect(seed.budgetAllocations.reduce((s, a) => s + a.amount, 0)).toBeLessThanOrEqual(budget.limit);

    for (const t of seed.transactions) {
      expect(memberIds.has(t.memberId!), t.description).toBe(true);
      expect(t.type).not.toBe('investment');
      const leg = t.type === 'income' ? t.toAccountId : t.accountId;
      expect(accountIds.has(leg!), `${t.description} has no account`).toBe(true);
    }
    expect(seed.accounts.filter(a => a.kind === 'cash')).toHaveLength(1);
    expect(seed.accounts.some(a => (a.paymentModes ?? []).includes('upi'))).toBe(false);   // global demo

    const owed = seed.transactions.filter(t => t.split?.paidBy === 'me' && t.split.participants.some(p => !p.isYou && !p.paid));
    expect(owed).toHaveLength(1);

    const emi = seed.transactions.filter(t => t.emiSplit);
    expect(emi.map(t => t.type).sort()).toEqual(['expense', 'expense', 'transfer', 'transfer']);
    for (const e of emi.filter(t => t.type === 'expense')) {
      const principal = emi.find(t => t.linkedTxnId === e.id)!;
      expect(e.category).toBe('loan_emi');
      expect(e.amount + principal.amount).toBeCloseTo(485, 2);
      expect(accountIds.has(principal.toAccountId!)).toBe(true);
    }
    const loan = seed.debts.find(d => d.type === 'auto_loan')!;
    expect(loan.currentBalance).toBeLessThan(12400);   // two EMIs applied
    expect(seed.goals).toEqual([]);                    // Goals is retired
  });
});
