// First-run demo household — local-only mode (no cloud). Cloud users get an empty
// household and onboarding instead; this demo is what previews, screenshots and the
// product video show.
//
// v10.53.0 (master to-do #68) — rebuilt on the current money model. The old demo
// predated it: per-category budgets with no allocations, no accounts, no recurring
// schedules, no money owed, investment rows without an account/asset, "this month"
// rows dated after today early in the month, and debt due dates of "<year>-13-…" in
// December. What the household shows in 30 seconds:
//   - two adults, every entry attributed to whoever added it;
//   - one monthly budget with category allocations;
//   - accounts with payment modes (joint checking, a named card, Cash in Hand);
//   - recurring bills (mortgage auto-posts; streaming waits for approval);
//   - money owed to you (a split dinner a friend hasn't paid back yet);
//   - a car loan paid by EMI (interest expense + principal transfer to the loan
//     account, built with the same applyPayment() the app uses);
//   - assets for net worth.
// Net worth snapshots are NOT seeded: history is "recorded once a month, never
// reconstructed" (v10.30.0), and invented figures must never become recorded
// history — so the chart starts from the first real month, as it does for everyone.
// No UPI: it is India-specific and the demo is a US household (global stance, 1 Oct).
import type {
  Transaction, Budget, BudgetAllocation, Goal, Member, Debt, Asset, Account, RecurringSchedule,
  Profile, ExchangeRates,
} from '../types';
import { DEFAULT_RATES } from '../constants';
import { uid } from './format';
import { loanView, planLoanPayment } from './loanSchedule';

export interface SeedBundle {
  members: Member[];
  goals: Goal[];
  debts: Debt[];
  assets: Asset[];
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  budgetAllocations: BudgetAllocation[];
  recurring: RecurringSchedule[];
  profile: Profile;
  exchangeRates: ExchangeRates;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar date as YYYY-MM-DD (never UTC, so "today" is the visitor's today). */
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * A day in a month `monthsBack` months before `now`, clamped to the month's length and,
 * for the current month, to today — so no seeded entry is ever dated in the future.
 */
export function demoDate(now: Date, monthsBack: number, day: number): string {
  const first = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  let d = Math.min(day, last);
  if (monthsBack === 0) d = Math.min(d, now.getDate());
  return ymd(new Date(first.getFullYear(), first.getMonth(), d));
}

/** The next date (after today) that falls on `day` of a month — rolls into next year in December. */
export function nextOnDay(now: Date, day: number): string {
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28));
  return ymd(thisMonth > now ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, Math.min(day, 28)));
}

export function buildSeed(now: Date = new Date()): SeedBundle {
  const alexId = uid(), samId = uid();
  const members: Member[] = [
    { id: alexId, name: 'Alex', role: 'primary' },
    { id: samId,  name: 'Sam',  role: 'partner' },
  ];

  // ── Accounts ─────────────────────────────────────────────────────────────
  const cashId = uid(), checkingId = uid(), cardId = uid();
  const accounts: Account[] = [
    { id: cashId, kind: 'cash', name: 'Cash in Hand', currency: 'USD', isDefault: true, openingBalance: 180, paymentModes: ['cash'] },
    { id: checkingId, kind: 'bank', name: 'Joint Checking', currency: 'USD', openingBalance: 7400,
      paymentModes: ['debit_card', 'online', 'auto_debit', 'net_banking'] },
    { id: cardId, kind: 'credit_card', name: 'Sapphire Card', currency: 'USD', openingBalance: 0,
      paymentModes: ['swipe', 'online'], creditLimit: 8000, billingCycleDay: 20, paymentDueDay: 15 },
  ];

  // ── Entries: three months, each attributed to who added it ───────────────
  // A current-month entry whose day hasn't come yet is left out (not moved to today):
  // its recurring bill, where there is one, posts it on the day.
  const tx = (monthsBack: number, day: number, t: Omit<Transaction, 'id' | 'date' | 'currency'>): Transaction | null =>
    monthsBack === 0 && day > now.getDate() ? null : ({ id: uid(), currency: 'USD', date: demoDate(now, monthsBack, day), ...t });
  const rows: (Transaction | null)[] = [];
  for (const back of [2, 1, 0]) {
    rows.push(
      tx(back, 1,  { type: 'income',  amount: 5200, category: 'salary', description: "Alex's salary", memberId: alexId, toAccountId: checkingId }),
      tx(back, 1,  { type: 'income',  amount: 4800, category: 'salary', description: "Sam's salary",  memberId: samId,  toAccountId: checkingId }),
      tx(back, 1,  { type: 'expense', amount: 2340, category: 'rent_mortgage', description: 'Mortgage', memberId: alexId, accountId: checkingId, paymentMode: 'auto_debit' }),
      tx(back, 5,  { type: 'expense', amount: 214,  category: 'food_dining', description: 'Groceries', memberId: samId, accountId: cardId, paymentMode: 'swipe' }),
      tx(back, 9,  { type: 'expense', amount: 92,   category: 'utilities', description: 'Electricity', memberId: alexId, accountId: checkingId, paymentMode: 'auto_debit' }),
      tx(back, 12, { type: 'expense', amount: 18,   category: 'entertainment', description: 'Streaming', memberId: samId, accountId: cardId, paymentMode: 'online' }),
      tx(back, 14, { type: 'expense', amount: 236,  category: 'food_dining', description: 'Groceries', memberId: alexId, accountId: cardId, paymentMode: 'swipe' }),
      tx(back, 18, { type: 'expense', amount: 64,   category: 'health', description: 'Pharmacy', memberId: samId, accountId: cashId, paymentMode: 'cash' }),
    );
  }
  rows.push(
    tx(2, 21, { type: 'expense', amount: 640, category: 'travel', description: 'Weekend away', memberId: alexId, accountId: cardId, paymentMode: 'online' }),
    tx(1, 10, { type: 'income',  amount: 950, category: 'freelance', description: 'Design project', memberId: alexId, toAccountId: checkingId }),
    tx(1, 22, { type: 'expense', amount: 185, category: 'shopping', description: 'School clothes', memberId: samId, accountId: cardId, paymentMode: 'swipe' }),
    tx(0, 6,  { type: 'expense', amount: 75,  category: 'education', description: 'Piano lessons', memberId: samId, accountId: checkingId, paymentMode: 'online' }),
  );
  // Money owed to you: Alex paid for dinner with a friend; Jordan hasn't paid back yet.
  // Dated last month so it shows on every day of the month, the 1st included.
  rows.push(tx(1, 26, {
    type: 'expense', amount: 120, category: 'food_dining', description: 'Dinner with Jordan', memberId: alexId, accountId: cardId, paymentMode: 'swipe',
    split: { isSplit: true, totalAmount: 120, yourShare: 60, paidBy: 'me', participants: [
      { name: 'me', isYou: true, share: 60, paid: true },
      { name: 'Jordan', share: 60, paid: false },
    ] },
  }));

  const transactions: Transaction[] = rows.filter((t): t is Transaction => t !== null);

  // ── Car loan paid by EMI (W4f: the loan model's own legs — interest + principal, per instalment) ──
  const firstPayment = demoDate(now, 2, 15);
  const [fy, fm] = firstPayment.split('-').map(Number);
  let carLoan: Debt = {
    id: uid(), type: 'auto_loan', name: 'Car loan', lender: 'City Credit Union', principal: 24000, currentBalance: 12400,
    interestRate: 4.9, minimumPayment: 485, tenureMonths: 60, instalmentsPaid: 31,
    firstEmiDate: ymd(new Date(fy, fm - 1 - 31, 15)), dueDate: firstPayment, termsConfirmed: true,
    currency: 'USD', direction: 'owed_by_me',
  };
  const loanAccountId = uid();
  const loanAccount: Account = { id: loanAccountId, kind: 'loan', name: carLoan.name, currency: 'USD', openingBalance: -12400, debtId: carLoan.id, isDefault: false, isArchived: false };
  for (const back of [2, 1]) {
    const date = demoDate(now, back, 15);
    const view = loanView({ ...carLoan, dueDate: date }, [loanAccount], transactions, 'USD', date);
    const plan = planLoanPayment(view, { kind: 'emi', amount: view.state.remaining, date }, 'USD');
    const emiSplit = { interest: plan.interest, principal: plan.principal, debt_id: carLoan.id, kind: 'emi' as const,
      instalment_no: plan.instalmentNo, operation_id: uid() };
    const expenseId = uid();
    transactions.push(
      { id: expenseId, type: 'expense', amount: plan.interest, currency: 'USD', date, description: 'Car loan EMI', category: 'loan_emi',
        memberId: alexId, accountId: checkingId, debtId: carLoan.id, linkedDebtId: carLoan.id, emiSplit, paymentMode: 'auto_debit' },
      { id: uid(), type: 'transfer', amount: plan.principal, currency: 'USD', date, description: 'Car loan EMI — principal', category: '',
        memberId: alexId, accountId: checkingId, toAccountId: loanAccountId, debtId: carLoan.id, linkedDebtId: carLoan.id, emiSplit, linkedTxnId: expenseId },
    );
    carLoan = { ...carLoan, currentBalance: plan.outstandingAfter, instalmentsPaid: (carLoan.instalmentsPaid ?? 0) + 1 };
  }
  carLoan = { ...carLoan, dueDate: nextOnDay(now, 15) };
  accounts.push(loanAccount);
  const debts: Debt[] = [
    carLoan,
    { id: uid(), type: 'student_loan', name: 'Student loan', lender: 'Federal loan servicer', principal: 32000, currentBalance: 14800,
      interestRate: 5.05, minimumPayment: 260, tenureMonths: 120, instalmentsPaid: 60, termsConfirmed: true,
      dueDate: nextOnDay(now, 8), currency: 'USD', direction: 'owed_by_me' },
  ];

  // ── Assets (net worth) ───────────────────────────────────────────────────
  const assets: Asset[] = [
    { id: uid(), type: 'real_estate', name: 'Home',        value: 420000, currency: 'USD', liquidity: 'long', note: 'Market estimate' },
    { id: uid(), type: 'vehicle',     name: 'Family car',  value: 19500,  currency: 'USD', liquidity: 'long' },
    { id: uid(), type: 'retirement',  name: '401(k)',      value: 86400,  currency: 'USD', liquidity: 'long' },
  ];

  // ── One monthly budget with category allocations (the current container model) ──
  const budgetId = uid();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const budgets: Budget[] = [{
    id: budgetId, limit: 1800, currency: 'USD', scope: 'month', periodYear: y, periodMonth: m,
    periodStart: ymd(new Date(y, m - 1, 1)), periodEnd: ymd(new Date(y, m, 0)),
  }];
  const budgetAllocations: BudgetAllocation[] = [
    ['food_dining', 700], ['utilities', 150], ['entertainment', 60], ['health', 120], ['shopping', 250], ['education', 120], ['travel', 200],
  ].map(([category, amount]) => ({ id: uid(), budgetId, category: category as string, amount: amount as number }));

  // ── Recurring bills ──────────────────────────────────────────────────────
  // Next due is always AFTER today, so nothing auto-posts on first load and duplicates
  // an entry seeded above.
  const monthly = (day: number) => ({ frequency: 'monthly' as const, dayOfMonth: day, rrule: `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${day}` });
  const recurring: RecurringSchedule[] = [
    { id: uid(), ...monthly(1), startDate: demoDate(now, 2, 1), nextDueDate: nextOnDay(now, 1), autoConfirm: true, active: true, reminderLeadDays: 3, ownerMemberId: alexId,
      transactionTemplate: { type: 'expense', amount: 2340, currency: 'USD', category: 'rent_mortgage', description: 'Mortgage', memberId: alexId, accountId: checkingId, paymentMode: 'auto_debit' } },
    { id: uid(), ...monthly(12), startDate: demoDate(now, 2, 12), nextDueDate: nextOnDay(now, 12), autoConfirm: false, active: true, reminderLeadDays: 2, ownerMemberId: samId,
      transactionTemplate: { type: 'expense', amount: 18, currency: 'USD', category: 'entertainment', description: 'Streaming', memberId: samId, accountId: cardId, paymentMode: 'online' } },
  ];

  const profile: Profile = {
    name: 'Alex Morgan',
    email: 'alex@example.com',
    baseCurrency: 'USD',
    language: 'en',
    household: 'family',
    dateFormat: 'us',
    payoffStrategy: 'avalanche',
    extraPayment: 100,
    // A finished household: never send the demo through onboarding.
    onboardedAt: now.toISOString(),
  };

  return {
    members, goals: [], debts, assets, accounts, transactions, budgets, budgetAllocations, recurring, profile,
    exchangeRates: { ...DEFAULT_RATES },
  };
}
