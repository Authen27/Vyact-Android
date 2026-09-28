import type { Account, Transaction } from '../types';
import { accountValueOf, creditAccountOf, debitAccountOf } from './accountBalance';
import { effectiveAmount, reportableTxns } from './calculations';

export type ReportPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface ReportBucket { label: string; start: string; end: string; income: number; expense: number; net: number; }

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function buildPeriodData(period: ReportPeriod, transactions: Transaction[], currency: string, rates: Record<string, number>, now = new Date()): ReportBucket[] {
  const counts: Record<ReportPeriod, number> = { day: 30, week: 12, month: 12, quarter: 8, year: 5 };
  const reportable = reportableTxns(transactions);
  return Array.from({ length: counts[period] }, (_, index) => {
    const offset = counts[period] - 1 - index;
    let startDate: Date;
    let endDate: Date;
    let label: string;
    if (period === 'day' || period === 'week') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset * (period === 'week' ? 7 : 1));
      if (period === 'week') startDate.setDate(startDate.getDate() - startDate.getDay());
      endDate = new Date(startDate);
      if (period === 'week') endDate.setDate(endDate.getDate() + 6);
      label = startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else {
      const month = period === 'year' ? 0 : period === 'quarter' ? Math.floor(now.getMonth() / 3) * 3 : now.getMonth();
      const span = period === 'month' ? 1 : period === 'quarter' ? 3 : 12;
      startDate = new Date(now.getFullYear(), month - offset * span, 1);
      endDate = new Date(startDate.getFullYear(), startDate.getMonth() + span, 0);
      label = period === 'year' ? String(startDate.getFullYear())
        : period === 'quarter' ? `Q${Math.floor(startDate.getMonth() / 3) + 1} '${String(startDate.getFullYear()).slice(2)}`
        : startDate.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }
    const start = dateKey(startDate);
    const end = dateKey(endDate);
    let income = 0;
    let expense = 0;
    for (const transaction of reportable.filter(row => row.date >= start && row.date <= end)) {
      const amount = effectiveAmount(transaction, currency, rates);
      if (transaction.type === 'income') income += amount;
      else expense += amount;
    }
    return { label, start, end, income, expense, net: income - expense };
  });
}

export function reportAccountId(transaction: Transaction, accounts: Account[]): string {
  const key = (transaction.type === 'income' ? creditAccountOf(transaction) : debitAccountOf(transaction)) || transaction.linkedAssetId;
  if (!key) return '';
  const account = accounts.find(row => row.id === key || accountValueOf(row) === key || row.assetId === key);
  return account?.id || key;
}