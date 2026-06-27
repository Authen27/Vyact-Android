// Vyact — home-screen widget data bridge.
//
// Computes today's income/spend + the current household's budget-used % using
// the SAME money-model-safe functions the app uses everywhere (reportableTxns /
// effectiveAmount / budgetLines), then writes them to @capacitor/preferences
// (SharedPreferences "CapacitorStorage") where the native AppWidgetProviders
// read them, and asks the native WidgetBridge to redraw. No-op on web.

import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { isNative } from './native';
import {
  reportableTxns, effectiveAmount, budgetLines, budgetWindow, spendByCategoryInRange,
} from './calculations';
import type { Transaction, Budget, BudgetAllocation, HouseholdMeta, ExchangeRates } from '../types';

const WidgetBridge = registerPlugin<{ refresh(): Promise<void> }>('WidgetBridge');

export interface WidgetInput {
  transactions: Transaction[];
  budgets: Budget[];
  budgetAllocations: BudgetAllocation[];
  households: HouseholdMeta[];
  currentHouseholdId: string;
  baseCurrency: string;
  rates: ExchangeRates;
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export async function syncWidgets(input: WidgetInput): Promise<void> {
  if (!isNative()) return;
  try {
    const { transactions, budgets, budgetAllocations, households, currentHouseholdId, baseCurrency, rates } = input;

    // Today's income / spend (money-model-safe: excludes transfers, investments,
    // reconciliation adjustments — reportableTxns does the filtering).
    const tk = todayKey();
    const todays = reportableTxns(transactions).filter(t => (t.date || '').slice(0, 10) === tk);
    const income = todays.filter(t => t.type === 'income').reduce((s, t) => s + effectiveAmount(t, baseCurrency, rates), 0);
    const spend  = todays.filter(t => t.type === 'expense').reduce((s, t) => s + effectiveAmount(t, baseCurrency, rates), 0);

    // Current household's overall budget-used %: spent ÷ limit across the active
    // budget lines (only the active household's budgets are loaded in the store).
    let limit = 0, spent = 0;
    for (const l of budgetLines(budgets, budgetAllocations)) {
      if (!l.limit || !l.category) continue;
      const w = budgetWindow(l);
      spent += spendByCategoryInRange(transactions, w.start, w.end, baseCurrency, rates)[l.category] || 0;
      limit += l.limit;
    }
    const pct = limit > 0 ? Math.min(999, Math.round((spent / limit) * 100)) : 0;

    const curName = households.find(h => h.id === currentHouseholdId)?.name || 'Household';
    const list = (households.length ? households : [{ id: currentHouseholdId, name: curName }])
      .map(h => ({ id: h.id, name: h.name }));

    const set = (key: string, value: string) => Preferences.set({ key, value });
    await Promise.all([
      set('widget.todayIncome', money(income, baseCurrency)),
      set('widget.todaySpend', money(spend, baseCurrency)),
      set('widget.budgetPct', String(pct)),
      set('widget.householdName', curName),
      set('widget.currentHid', currentHouseholdId),
      set(`widget.budget.${currentHouseholdId}.pct`, String(pct)),
      set(`widget.budget.${currentHouseholdId}.label`, curName),
      set('widget.households', JSON.stringify(list)),
      set('widget.updatedAt', new Date().toISOString()),
    ]);

    await WidgetBridge.refresh().catch(() => { /* no widget added yet — fine */ });
  } catch (e) {
    console.warn('widget sync failed:', e);
  }
}
