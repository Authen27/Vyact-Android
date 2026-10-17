// Track E, E6a (v10.100.0; owner decisions 13 Oct 2026: "each loan's EMI shown in Recurring, mirrored from
// the loan", E-3 and E-4) — a loan's EMIs as Recurring and the budget form read them.
//
// A loan's EMI is never a recurring SCHEDULE (D19: `pay_loan` pays it, an interest expense + a principal
// transfer split by the server; `auto_record_due_emis` records it on its date when the loan says so).
// Recurring therefore MIRRORS each live loan from its own schedule (`loanView`) — it never stores one —
// and its "Record automatically" switch is the loan's own `autoRecord`, so an EMI can never be scheduled
// twice. The leftover EMI schedules from before W4g are hidden everywhere (`isLoanEmiSchedule`).
//
// Pure: no store, no browser API.
import type { Account, Debt, Transaction } from '../types';
import { loanView, nextInstalmentDate } from './loanSchedule';
import { today } from './format';

export interface LoanEmiRow {
  debt: Debt;
  /** The instalment due: its number and date (null when the loan has no next EMI date). */
  no: number;
  date: string | null;
  /** What is still to pay on it (less than the EMI when it is part-paid, or the last one). */
  amount: number;
  /** The loan's EMI. */
  emi: number;
  /** The account the EMI is recorded from when Vyact records it. */
  fundingAccount?: Account;
  autoRecord: boolean;
  /** What "Record automatically" still needs: the paying account and/or the next EMI date. */
  needs: ('account' | 'date')[];
  /** The last instalment's date, when the EMI clears the loan. */
  clearsOn: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A loan the household pays by EMI and still owes on: what Recurring and the forecast mirror. */
function liveLoans(debts: readonly Debt[]): Debt[] {
  return debts.filter(d => (d.direction ?? 'owed_by_me') !== 'owed_to_me' && d.type !== 'credit_card' && d.minimumPayment > 0 && !d.paidOffAt);
}

/** One row per live loan, the next EMI first. */
export function loanEmiRows(
  debts: readonly Debt[], accounts: readonly Account[], transactions: readonly Transaction[],
  baseCurrency: string, now: string = today(),
): LoanEmiRow[] {
  const rows: LoanEmiRow[] = [];
  for (const debt of liveLoans(debts)) {
    const view = loanView(debt, accounts, transactions, baseCurrency, now);
    if (view.paidOff) continue;
    const fundingAccount = debt.fundingAccountId ? accounts.find(a => a.id === debt.fundingAccountId && !a.isArchived) : undefined;
    const needs: LoanEmiRow['needs'] = [];
    if (!fundingAccount) needs.push('account');
    if (!debt.dueDate) needs.push('date');
    rows.push({
      debt, no: view.state.no, date: view.state.date,
      amount: round2(view.state.remaining), emi: debt.minimumPayment,
      ...(fundingAccount ? { fundingAccount } : {}),
      autoRecord: !!debt.autoRecord, needs, clearsOn: view.clearsOn,
    });
  }
  return rows.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.debt.name.localeCompare(b.debt.name));
}

/**
 * E-4 — what the live loans' EMIs come to in a budget period, on their real dates: the instalments
 * already due in the period (from the first EMI date, at the EMI) and the ones the loan's schedule still
 * holds (the due one at its full amount, the last one at what it clears). Read beside
 * `recurringForecastByCategory` by the budget form, under Loan / EMI.
 */
export function loanEmiForecast(
  debts: readonly Debt[], accounts: readonly Account[], transactions: readonly Transaction[],
  periodStart: string, periodEnd: string, baseCurrency: string, now: string = today(),
): number {
  let total = 0;
  for (const debt of liveLoans(debts)) {
    const view = loanView(debt, accounts, transactions, baseCurrency, now);
    if (view.paidOff || !view.state.date) continue;
    // Instalments before the due one, on the loan's own day, from its first EMI date.
    const anchor = Number((debt.firstEmiDate ?? debt.dueDate ?? '').slice(8, 10)) || null;
    if (debt.firstEmiDate && anchor) {
      for (let date = debt.firstEmiDate, n = 0; date < view.state.date && date <= periodEnd && n < 600; date = nextInstalmentDate(date, anchor), n++) {
        if (date >= periodStart) total += debt.minimumPayment;
      }
    }
    // The due instalment (at its full amount, even when part-paid) and the ones after it.
    for (const row of view.schedule) {
      if (!row.date || row.date > periodEnd) break;
      if (row.date < periodStart) continue;
      total += row.no === view.state.no ? view.state.due : row.payment;
    }
  }
  return round2(total);
}
