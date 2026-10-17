// W6 (audit FE-UIC-06) — the Net Worth "Liabilities" list, read from the ONE projection.
//
// The list mapped `debts` alone: a credit card (an ACCOUNT since D30) never appeared, a household
// whose only debt was a card was told "No debts tracked", and the rows never summed to the Total
// Liabilities figure printed under them. These rows are exactly the ones that total is made of.
import { DEBT_TYPES } from '../constants';
import type { Debt } from '../types';
import type { LiabilityRow, NetWorthProjection } from './netWorth';

/** What is owed, row by row: the projection's liability rows with something on them. */
export function liabilityList(projection: Pick<NetWorthProjection, 'liabilityRows'>): LiabilityRow[] {
  return projection.liabilityRows.filter(r => r.value > 0);
}

/** The icon and the second line for a row: a card is managed in Accounts, a loan shows its terms. */
export function liabilityRowLabel(row: LiabilityRow, debts: Pick<Debt, 'id' | 'type' | 'interestRate'>[]): { icon: string; sub: string } {
  if (row.source === 'account' && row.account?.kind === 'credit_card') {
    return { icon: '💳', sub: 'Credit card · managed in Accounts' };
  }
  const debt = row.debt ?? (row.account?.debtId ? debts.find(d => d.id === row.account!.debtId) : undefined);
  if (!debt) return { icon: DEBT_TYPES.other.icon, sub: 'Loan' };
  const { icon, label } = DEBT_TYPES[debt.type] || DEBT_TYPES.other;
  return { icon, sub: `${label} · ${debt.interestRate}% APR` };
}
