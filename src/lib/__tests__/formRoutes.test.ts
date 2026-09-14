import { describe, expect, it } from 'vitest';
import { formPath, isFormRoute } from '../formRoutes';

describe('entity form routes (v10.28.0)', () => {
  it('builds every form path and recognises each as a form route', () => {
    const paths = [
      formPath.transactionNew(), formPath.transactionEdit('t1'),
      formPath.splitNew(), formPath.splitEdit('t2'),
      formPath.debtNew(), formPath.debtEdit('d1'),
      formPath.budgetNew(), formPath.budgetEdit('b1'),
      formPath.accountNew(), formPath.accountEdit('a1'), formPath.accountReconcile('a1'),
      formPath.assetNew(), formPath.assetEdit('s1'),
    ];
    expect(paths).toEqual([
      '/transactions/new', '/transactions/t1/edit',
      '/splits/new', '/splits/t2/edit',
      '/debts/new', '/debts/d1/edit',
      '/budgets/new', '/budgets/b1/edit',
      '/accounts/new', '/accounts/a1/edit', '/accounts/a1/reconcile',
      '/networth/assets/new', '/networth/assets/s1/edit',
    ]);
    for (const path of paths) expect(isFormRoute(path), path).toBe(true);
  });

  it('leaves the screens themselves, and non-form sub-paths, to the Layout', () => {
    for (const path of [
      '/transactions', '/splits', '/debts', '/budgets', '/accounts', '/networth', '/dashboard',
      '/networth/assets', '/transactions/t1', '/budgets/b1/reconcile', '/settings/new', '/onboarding',
    ]) {
      expect(isFormRoute(path), path).toBe(false);
    }
  });

  it('keeps an id with reserved characters inside one path segment', () => {
    const path = formPath.transactionEdit('a/b c');
    expect(path).toBe('/transactions/a%2Fb%20c/edit');
    expect(isFormRoute(path)).toBe(true);
  });
});
