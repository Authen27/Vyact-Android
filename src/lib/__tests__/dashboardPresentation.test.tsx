import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { FEATURES } from '../../config/features';
import Dashboard from '../../pages/Dashboard';
import type { Store } from '../../store';

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));
vi.mock('../../store', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store')>();
  return { ...actual, useStore: Object.assign((selector: (state: Store) => unknown) => selector(actual.useStore.getState()), actual.useStore) };
});
vi.mock('../../components/ui/AnimatedMoney', async () => ({ default: (await import('../../components/ui/Money')).default }));

beforeEach(() => {
  vi.stubGlobal('React', React);
  const logError = console.error;
  vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (!String(message).startsWith('Warning: useLayoutEffect does nothing on the server')) logError(message, ...args);
  });
  Object.assign(FEATURES.dashboard, { showPulse: false, showDebtSummary: false });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
  useStore.setState({ ...useStore.getInitialState(), transactions: [], assets: [], budgets: [], budgetAllocations: [],
    accounts: [{ id: 'bank', name: 'Bank', kind: 'bank', currency: 'USD', openingBalance: 1000 }],
    debts: [{ id: 'loan', name: 'Loan', type: 'loan', currency: 'USD', principal: 200, currentBalance: 200, minimumPayment: 20, interestRate: 0 }],
    profile: { ...useStore.getInitialState().profile, baseCurrency: 'USD' }, rates: { USD: 1 } });
});
afterEach(() => { Object.assign(FEATURES.dashboard, { showPulse: false, showDebtSummary: false }); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function render() {
  return renderToStaticMarkup(<MemoryRouter><Dashboard /></MemoryRouter>);
}

it('MVP omits Pulse and Debt summaries while keeping Net Worth liabilities', () => {
  expect(FEATURES.dashboard).toEqual({ showPulse: false, showDebtSummary: false });
  const html = render();
  expect(html).not.toContain('data-testid="dashboard-pulse"');
  expect(html).not.toContain('data-testid="dashboard-debt-summary"');
  expect(html).not.toContain('230px');
  expect(html).toContain('title="$800"');
  expect(html).toContain('Liabilities');
  expect(useStore.getState().debts[0].currentBalance).toBe(200);
});

it.each(['showPulse', 'showDebtSummary'] as const)('%s can be enabled independently without changing the Net Worth figure', flag => {
  const before = render();
  Object.assign(FEATURES.dashboard, { [flag]: true });
  const after = render();
  expect(after).toContain(flag === 'showPulse' ? 'data-testid="dashboard-pulse"' : 'data-testid="dashboard-debt-summary"');
  expect(after).not.toContain(flag === 'showPulse' ? 'data-testid="dashboard-debt-summary"' : 'data-testid="dashboard-pulse"');
  expect(before).toContain('title="$800"');
  expect(after).toContain('title="$800"');
});