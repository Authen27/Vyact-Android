import { describe, expect, it, vi } from 'vitest';
import { wireOnboardingToMoney } from '../onboardingWiring';
import type { Account, RecurringSchedule } from '../../types';

function fixture(openingBalance = 0) {
  let cash: Account = { id: 'cash-account', name: 'Cash', kind: 'cash', currency: 'USD', openingBalance };
  const fns = {
    ensureDefaultCashAccount: vi.fn().mockResolvedValue(undefined),
    getCashAccount: () => cash,
    upsertAccount: vi.fn(async (value: Partial<Account>) => (cash = { ...cash, ...value })),
    upsertRecurring: vi.fn(async (value: Partial<RecurringSchedule>) => ({ ...value, id: crypto.randomUUID() } as RecurringSchedule)),
    saveOnboardingBudget: vi.fn().mockResolvedValue(undefined),
  };
  return { fns, now: new Date('2026-09-09T12:00:00Z'), currency: 'USD', memberId: 'member', monthlyIncome: 3000,
    bills: [{ key: 'rent', label: 'Rent', amount: 900 }, { key: 'utilities', label: 'Electricity', amount: 100 },
      { key: 'phone', label: 'Phone', amount: 50 }, { key: 'subscriptions', label: 'Unused', amount: 0 }] };
}

describe('onboarding financial setup', () => {
  it('writes estimated Cash, future approval-gated paycheck and bills, and a merged join-month budget', async () => {
    const input = fixture();
    await wireOnboardingToMoney(input);
    expect(input.fns.ensureDefaultCashAccount).toHaveBeenCalledOnce();
    expect(input.fns.getCashAccount()).toMatchObject({ openingBalance: 3000, confidence: 'estimated', source: 'onboarding' });
    const schedules = input.fns.upsertRecurring.mock.calls.map(([schedule]) => schedule);
    expect(schedules).toHaveLength(4);
    expect(schedules[0]).toMatchObject({ nextDueDate: '2026-10-01', autoConfirm: false,
      transactionTemplate: { type: 'income', amount: 3000, category: 'salary', toAccountId: 'cash-account', memberId: 'member' } });
    for (const schedule of schedules.slice(1)) {
      expect(schedule).toMatchObject({ nextDueDate: '2026-10-02', autoConfirm: false, active: true,
        transactionTemplate: { type: 'expense', accountId: 'cash-account', currency: 'USD', memberId: 'member' } });
    }
    expect(input.fns.saveOnboardingBudget).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ scope: 'month', periodYear: 2026, periodMonth: 9, limit: 1050,
        periodStart: '2026-09-01', periodEnd: '2026-09-30', confidence: 'estimated' }),
      [{ category: 'rent_mortgage', amount: 900 }, { category: 'utilities', amount: 150 }],
    );
  });

  it('preserves an existing Cash balance while still setting up the supplied bills', async () => {
    const input = fixture(450);
    await wireOnboardingToMoney(input);
    expect(input.fns.upsertAccount).not.toHaveBeenCalled();
    expect(input.fns.upsertRecurring).toHaveBeenCalledTimes(3);
    expect(input.fns.getCashAccount().openingBalance).toBe(450);
  });

  it('completes an empty setup without inventing balances, schedules or a budget', async () => {
    const input = { ...fixture(), monthlyIncome: 0, bills: [] };
    await wireOnboardingToMoney(input);
    expect(input.fns.ensureDefaultCashAccount).toHaveBeenCalledOnce();
    expect(input.fns.upsertAccount).not.toHaveBeenCalled();
    expect(input.fns.upsertRecurring).not.toHaveBeenCalled();
    expect(input.fns.saveOnboardingBudget).not.toHaveBeenCalled();
  });
});