// Onboarding → real money wiring (v10.13).
//
// The redesigned onboarding (revamp/Vyact Aurora · Onboarding.html) captures a
// salaried person's actual numbers, so — unlike the old "estimated reference
// baseline" that wiped itself — we turn them into REAL, first-class money-model
// objects the user can see and edit from day one:
//
//   1. Monthly take-home  → the default Cash account's OPENING BALANCE
//      (cash-in-hand today). Not a transaction — an account starting balance.
//   2. Monthly take-home  → a recurring INCOME schedule (the paycheck), monthly
//      on the 1st, crediting the Cash account. Starts NEXT 1st (strictly future)
//      so it never double-counts the opening balance, and `autoConfirm:false`
//      so it never posts silently — the user approves it from Recurring.
//   3. Each fixed bill     → a recurring EXPENSE schedule, monthly on the 2nd,
//      debiting the Cash account, in its mapped category. Also future-dated +
//      `autoConfirm:false` — "do not auto-pay until the user reviews."
//   4. The bills together   → a real BUDGET for the join month (even if the join
//      date has already passed), with one allocation per category.
//
// CRITICAL money-model note: none of this POSTS a transaction. Opening balances,
// recurring *schedules* (future-dated, approval-gated) and budgets don't move
// spend/income, so the money invariants can't be violated by onboarding. The
// only thing that ever moves the Cash account is a transaction the user later
// approves — exactly as the model requires.

import type { RecurringSchedule, BudgetAllocation, Account, Budget } from '../types';

/** Fixed-cost chip key → real expense category id (constants.ts EXPENSE_CATEGORIES). */
const CHIP_CATEGORY: Record<string, string> = {
  rent: 'rent_mortgage',
  mortgage: 'rent_mortgage',
  utilities: 'utilities',
  phone: 'utilities',
  subscriptions: 'entertainment',
  transport: 'transport',
  childcare: 'childcare',
  groceries: 'groceries',
  insurance: 'insurance',
  // SMB chips — no dedicated categories, fold into "other".
  payroll: 'other_expense',
  software: 'other_expense',
  contractors: 'other_expense',
  marketing: 'other_expense',
  taxes: 'other_expense',
};

export function chipCategory(key: string): string {
  return CHIP_CATEGORY[key] ?? 'other_expense';
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * The next calendar date landing on `dayOfMonth`, STRICTLY AFTER `from`. Used so
 * an onboarding schedule's first occurrence is always in the future — which both
 * (a) prevents `upsertRecurring` from seeding an immediate transaction (its seed
 * guard is `startDate <= today`), and (b) means nothing posts until the real
 * date arrives and the user approves it. Clamps to the month's last day for
 * short months (e.g. day 31 in February → the 28th/29th).
 */
export function nextMonthlyDate(dayOfMonth: number, from: Date): string {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const clampDay = (year: number, month: number) =>
    Math.min(dayOfMonth, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());

  const thisMonth = new Date(Date.UTC(y, m, clampDay(y, m)));
  if (thisMonth.getTime() > from.getTime()) return iso(thisMonth);
  // Otherwise the target day this month is today or past → use next month.
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 0 : m + 1;
  return iso(new Date(Date.UTC(ny, nm, clampDay(ny, nm))));
}

export interface OnboardingBill {
  key: string;
  label: string;
  /** Rupees/dollars — omitted or 0 = a name-only budget line, no recurring expense. */
  amount: number;
}

/** Sum bill amounts by their resolved category (two chips can map to one
 *  category, e.g. Utilities + Phone → utilities) for the budget allocations. */
export function mergeAllocationsByCategory(bills: OnboardingBill[]): { category: string; amount: number }[] {
  const byCat = new Map<string, number>();
  for (const b of bills) {
    if (!(b.amount > 0)) continue;
    const cat = chipCategory(b.key);
    byCat.set(cat, (byCat.get(cat) ?? 0) + b.amount);
  }
  return [...byCat.entries()].map(([category, amount]) => ({ category, amount }));
}

export interface WireOnboardingInput {
  monthlyIncome: number;
  bills: OnboardingBill[];
  currency: string;
  memberId?: string;
  now?: Date;
  fns: {
    ensureDefaultCashAccount: () => Promise<void>;
    getCashAccount: () => Account | undefined;
    upsertAccount: (a: Partial<Account>) => Promise<Account>;
    upsertRecurring: (s: Partial<RecurringSchedule>) => Promise<RecurringSchedule>;
    saveOnboardingBudget: (
      b: Partial<Budget>, allocs: Partial<BudgetAllocation>[],
    ) => Promise<void>;
  };
}

/**
 * Turn the onboarding inputs into real money-model objects. Best-effort per
 * step — a failure in one (e.g. a budget already exists for the join month)
 * never blocks the others or the flow completing.
 */
export async function wireOnboardingToMoney(input: WireOnboardingInput): Promise<void> {
  const { monthlyIncome, bills, currency, memberId, fns } = input;
  const now = input.now ?? new Date();

  // 1 + 2 — Cash opening balance + the paycheck schedule.
  await fns.ensureDefaultCashAccount().catch(() => {});
  const cash = fns.getCashAccount();
  const cashRef = cash ? (cash.assetId ? `asset:${cash.assetId}` : cash.id) : 'cash';

  if (cash && monthlyIncome > 0 && !cash.openingBalance) {
    await fns.upsertAccount({
      ...cash,
      openingBalance: monthlyIncome,
      confidence: 'estimated',
      source: 'onboarding',
      estimatedAt: now.toISOString(),
    }).catch(() => {});

    // Paycheck — recurring income, 1st of month, into Cash, approval-gated.
    const payStart = nextMonthlyDate(1, now);
    await fns.upsertRecurring({
      frequency: 'monthly',
      dayOfMonth: 1,
      startDate: payStart,
      nextDueDate: payStart,
      autoConfirm: false,
      active: true,
      transactionTemplate: {
        type: 'income',
        amount: monthlyIncome,
        currency,
        category: 'salary',
        description: 'Monthly paycheck',
        // income lands IN the Cash account (toAccountId is the credit side).
        toAccountId: cash.id,
        paymentMethod: cashRef,
        ...(memberId ? { memberId } : {}),
      } as RecurringSchedule['transactionTemplate'],
    }).catch(() => {});
  }

  // 3 — one recurring EXPENSE schedule per bill that carries an amount, on the
  // 2nd, debiting Cash, approval-gated (never auto-pays until reviewed).
  const billStart = nextMonthlyDate(2, now);
  for (const bill of bills) {
    if (!(bill.amount > 0)) continue;
    await fns.upsertRecurring({
      frequency: 'monthly',
      dayOfMonth: 2,
      startDate: billStart,
      nextDueDate: billStart,
      autoConfirm: false,
      active: true,
      transactionTemplate: {
        type: 'expense',
        amount: bill.amount,
        currency,
        category: chipCategory(bill.key),
        description: bill.label,
        accountId: cash?.id,
        paymentMethod: cashRef,
        ...(memberId ? { memberId } : {}),
      } as RecurringSchedule['transactionTemplate'],
    }).catch(() => {});
  }

  // 4 — a budget for the JOIN month (created even if the month is already
  // underway), one allocation per category from the bills.
  const allocs = mergeAllocationsByCategory(bills);
  if (allocs.length) {
    const y = now.getUTCFullYear();
    const mo = now.getUTCMonth() + 1;
    const total = allocs.reduce((s, a) => s + a.amount, 0);
    const periodStart = `${y}-${pad(mo)}-01`;
    const periodEnd = iso(new Date(Date.UTC(y, mo, 0)));
    await fns.saveOnboardingBudget(
      {
        scope: 'month',
        periodYear: y,
        periodMonth: mo,
        period: 'monthly',
        periodStart,
        periodEnd,
        limit: total,
        currency,
        confidence: 'estimated',
        source: 'onboarding',
      },
      allocs.map(a => ({ category: a.category, amount: a.amount })),
    ).catch(() => {});
  }
}
