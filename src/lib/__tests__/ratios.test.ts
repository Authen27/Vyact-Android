import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { debtToIncomePct, keptThisMonthPct, pctLabel } from '../ratios';

const read = (p: string) => readFileSync(resolve(__dirname, '../../pages', p), 'utf8');

describe('debt-to-income and "kept this month" (W6, audit FE-UIC-07)', () => {
  it('W6-UIC07-001 · this month\'s income is the base; no income means no figure, never a divide-by-1', () => {
    expect(debtToIncomePct(30_000, 1_00_000)).toBe(30);
    expect(debtToIncomePct(30_000, 0)).toBeNull();                 // was 360% (one month) or 10% (three years)
    expect(keptThisMonthPct(1_00_000, 70_000)).toBe(30);
    expect(keptThisMonthPct(0, 5_000)).toBeNull();                 // was −499,900.0% on the 2nd of a month
    expect(keptThisMonthPct(50_000, 60_000)).toBe(-20);            // a real overspend still shows its minus
    expect(pctLabel(null, 1)).toBe('—');
    expect(pctLabel(12.345, 1)).toBe('12.3%');
  });

  it('W6-UIC07-002 · Debts, Dashboard and Net Worth read the one definition', () => {
    const debts = read('Debts.tsx');
    expect(debts).toMatch(/debtToIncomePct\(totalMonthlyDebtPayment\(debts, c, rates\), monthlyData\(transactions, nowMonthKey\(\), c, rates\)\.income\)/);
    expect(debts).not.toMatch(/\|\| 1;\s*\n\s*const dti/);
    expect(read('Dashboard.tsx')).toMatch(/debtToIncomePct\(monthlyDebtPmt, month\.income\)/);
    const nw = read('NetWorth.tsx');
    expect(nw).toMatch(/keptThisMonthPct\(income, expense\)/);
    expect(nw).not.toMatch(/income \|\| 1/);
  });
});
