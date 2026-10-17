// W8a (audit FE-UIC-15) — an account's ledger rows with the running balance after each one.
// The walk starts from the current balance (opening + ledger + every reconcile offset) and steps back
// through the transactions. It used to step back over transactions only, so every row older than a
// reconcile showed a balance still carrying that later adjustment. Now each reconcile delta is undone
// as the walk passes the day it was applied (a same-day reconcile counts as after that day's entries).
import type { Account, Transaction } from '../types';
import { accountValueOf, computeAccountBalance, creditAccountOf, debitAccountOf } from './accountBalance';
import { effectiveAmount } from './calculations';
import { dateKeyIn } from './format';

export interface LedgerRow { t: Transaction; impact: number; runningAfter: number }

export function accountLedgerRows(
  account: Account, txns: Transaction[], baseCur: string, rates: Record<string, number>,
): LedgerRow[] {
  const accountValue = accountValueOf(account);
  // Match by account uuid OR the legacy encoded value; income credits the destination;
  // transfer/investment touch both legs (R-AGG-4).
  const hits = (v: string | undefined) => v === account.id || v === accountValue;
  const mine = txns
    .map(t => {
      const amt = effectiveAmount(t, baseCur, rates);
      let impact = 0;
      if (t.type === 'income' && hits(creditAccountOf(t))) impact = amt;
      else if (t.type === 'expense' && hits(debitAccountOf(t))) impact = -amt;
      else if (t.type === 'transfer' || t.type === 'investment') {
        impact = (hits(creditAccountOf(t)) ? amt : 0) - (hits(debitAccountOf(t)) ? amt : 0);
      }
      return { t, impact };
    })
    .filter(r => r.impact !== 0)
    .sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0));
  // Reconcile adjustments, newest first, by the day they were applied.
  const adjustments = (account.reconciliationLog ?? [])
    .map(e => ({ day: e.at.length > 10 ? dateKeyIn(new Date(e.at)) : e.at, delta: e.delta }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  let next = 0;
  let running = computeAccountBalance(account, txns, baseCur, rates);
  return mine.map(r => {
    while (next < adjustments.length && adjustments[next].day >= r.t.date) running -= adjustments[next++].delta;
    const at = Math.round(running * 100) / 100;
    running -= r.impact;
    return { ...r, runningAfter: at };
  });
}
