// Vyact — entity CRUD slice (TD-25 sub-split of the data core).
//
// The repetitive household-scoped entity writes (budget / allocation / goal /
// member / debt / asset / account / saved-view). Each persists via the adapter
// then updates the in-memory array; no money-math (the money-critical
// upsertTransaction / recordDebtPayment stay in dataSlice). Moved verbatim;
// reads/writes the rest of the store via get()/set().
import type { StateCreator } from 'zustand';
import type { Store } from '../../store';
import type { Budget, BudgetAllocation, Goal, Member, Debt, Asset, Account, SavedView } from '../../types';
import { uid } from '../../lib/format';
import { can } from '../../lib/permissions';

// v9.5.0 — budget management is owner/admin only. The DB enforces it (RLS +
// upsert_budget guard); this is the client-side guard so a non-manager who
// bypasses the (hidden) UI gets a clear message instead of a raw 42501/RLS reject.
const assertCanManageBudgets = (role: import('../../types').AppRole | undefined): void => {
  if (!can(role, 'manage_budgets')) {
    throw new Error('Only the household owner or admin can manage budgets.');
  }
};

export interface CrudSlice {
  upsertBudget: (b: Partial<Budget>) => Promise<Budget>;
  removeBudget: (id: string) => Promise<void>;
  /** v9.1 §4 — replace a budget's per-category allocations. */
  setBudgetAllocations: (budgetId: string, rows: Partial<BudgetAllocation>[]) => Promise<BudgetAllocation[]>;
  /** Budget-sync fix — write a budget AND its allocations atomically online (one
   *  RPC), so children can't silently dead-letter. The save path the form uses. */
  saveBudgetWithAllocations: (budget: Partial<Budget>, allocations: Partial<BudgetAllocation>[]) => Promise<{ budget: Budget; allocations: BudgetAllocation[] }>;
  upsertGoal: (g: Partial<Goal>) => Promise<Goal>;
  removeGoal: (id: string) => Promise<void>;
  upsertMember: (m: Partial<Member>) => Promise<Member>;
  removeMember: (id: string) => Promise<void>;
  upsertDebt: (d: Partial<Debt>) => Promise<Debt>;
  removeDebt: (id: string) => Promise<void>;
  upsertAsset: (a: Partial<Asset>) => Promise<Asset>;
  removeAsset: (id: string) => Promise<void>;
  upsertAccount: (a: Partial<Account>) => Promise<Account>;
  removeAccount: (id: string) => Promise<void>;
  upsertSavedView: (v: Partial<SavedView>) => Promise<SavedView>;
  removeSavedView: (id: string) => Promise<void>;
}

export const createCrudSlice: StateCreator<Store, [], [], CrudSlice> = (set, get) => ({
  upsertBudget: async (b) => {
    assertCanManageBudgets(get().myRole);
    const { adapter, currentHouseholdId, budgets } = get();
    // v9.3.3 — the DB owns budget identity (household, scope, period), enforced by
    // uq_budget_month/uq_budget_annual. A NEW budget goes through the identity-aware
    // create authority (`createBudgetChecked` → upsert_budget RPC): it assigns the
    // id and rejects a duplicate slot — including another member's unsynced one —
    // with BudgetExistsError, rather than minting a client id that collides and
    // dead-letters. An EDIT keeps its id and uses the concurrency-safe update path.
    // (The v9.3.1 deterministic-id approach was removed: coupling PK to identity
    // broke delete+recreate and clashed with recovered random-id rows.)
    let saved: Budget;
    if (!b.id) {
      saved = await adapter.createBudgetChecked(currentHouseholdId, b);
    } else {
      saved = await adapter.upsert('budgets', currentHouseholdId, b, b.updated_at ? b.updated_at : undefined) as Budget;
    }
    // Period metadata now lives on the row itself (PR #20). The adapter's
    // rowToBudget mapper returns `period` / `periodStart` / `periodEnd`.
    const merged: Budget = { ...saved, period: saved.period || b.period || 'monthly' };
    const idx = budgets.findIndex(x => x.id === saved.id);
    set({ budgets: idx >= 0 ? budgets.map(x => x.id === saved.id ? merged : x) : [...budgets, merged] });
    return merged;
  },
  removeBudget: async (id) => {
    assertCanManageBudgets(get().myRole);
    const { adapter, currentHouseholdId, budgets, budgetAllocations } = get();
    await adapter.remove('budgets', currentHouseholdId, id);
    // Cascade allocations locally (DB cascades via FK on delete; soft-delete
    // here just drops them from memory).
    set({
      budgets: budgets.filter(x => x.id !== id),
      budgetAllocations: budgetAllocations.filter(a => a.budgetId !== id),
    });
  },
  // Budget-sync fix — atomic budget + allocations save via one online RPC. This is
  // the durable path the form uses (replaces the old upsertBudget + per-row
  // setBudgetAllocations two-step, whose child writes could silently dead-letter).
  saveBudgetWithAllocations: async (budget, allocs) => {
    assertCanManageBudgets(get().myRole);
    const { adapter, currentHouseholdId, budgets, budgetAllocations } = get();
    const mode: 'create' | 'replace' = budget.id ? 'replace' : 'create';
    const { budget: saved, allocations } = await adapter.upsertBudgetWithAllocations(currentHouseholdId, budget, allocs, mode);
    const merged: Budget = { ...saved, period: saved.period || budget.period || 'monthly' };
    const idx = budgets.findIndex(x => x.id === saved.id);
    const others = budgetAllocations.filter(a => a.budgetId !== saved.id);
    set({
      budgets: idx >= 0 ? budgets.map(x => x.id === saved.id ? merged : x) : [...budgets, merged],
      budgetAllocations: [...others, ...allocations],
    });
    return { budget: merged, allocations };
  },
  // v9.1 §4 — replace the full per-category allocation set for one budget.
  setBudgetAllocations: async (budgetId, rows) => {
    assertCanManageBudgets(get().myRole);
    const { adapter, currentHouseholdId, budgetAllocations } = get();
    const others = budgetAllocations.filter(a => a.budgetId !== budgetId);
    const saved: BudgetAllocation[] = [];
    // remove allocations the user dropped
    const keepIds = new Set(rows.filter(r => r.id).map(r => r.id));
    for (const a of budgetAllocations.filter(a => a.budgetId === budgetId)) {
      if (!keepIds.has(a.id)) await adapter.remove('budgetAllocations', currentHouseholdId, a.id);
    }
    // upsert the current set
    for (const r of rows) {
      const row = await adapter.upsert('budgetAllocations', currentHouseholdId, { ...r, budgetId });
      saved.push(row as BudgetAllocation);
    }
    set({ budgetAllocations: [...others, ...saved] });
    return saved;
  },
  upsertGoal: async (g) => {
    const { adapter, currentHouseholdId, goals } = get();
    // TD-03 phase B (PR #12): thread the version precondition on edits.
    const saved = await adapter.upsert('goals', currentHouseholdId, g, g.id && g.updated_at ? g.updated_at : undefined);
    const idx = goals.findIndex(x => x.id === saved.id);
    set({ goals: idx >= 0 ? goals.map(x => x.id === saved.id ? saved as Goal : x) : [...goals, saved as Goal] });
    return saved as Goal;
  },
  removeGoal: async (id) => {
    const { adapter, currentHouseholdId, goals } = get();
    await adapter.remove('goals', currentHouseholdId, id);
    set({ goals: goals.filter(x => x.id !== id) });
  },
  upsertMember: async (m) => {
    const { adapter, currentHouseholdId, members } = get();
    const saved = await adapter.upsert('members', currentHouseholdId, m);
    const idx = members.findIndex(x => x.id === saved.id);
    set({ members: idx >= 0 ? members.map(x => x.id === saved.id ? saved as Member : x) : [...members, saved as Member] });
    return saved as Member;
  },
  removeMember: async (id) => {
    const { adapter, currentHouseholdId, members, transactions } = get();
    // Orphan linked transactions
    const linked = transactions.filter(t => t.memberId === id);
    for (const t of linked) {
      const updated = { ...t, memberId: '' };
      await adapter.upsert('transactions', currentHouseholdId, updated);
    }
    await adapter.remove('members', currentHouseholdId, id);
    set({
      members: members.filter(x => x.id !== id),
      transactions: transactions.map(t => t.memberId === id ? { ...t, memberId: '' } : t),
    });
  },
  upsertDebt: async (d) => {
    const { adapter, currentHouseholdId, debts } = get();
    // TD-03 phase B (PR #12): thread the version precondition on edits.
    const saved = await adapter.upsert('debts', currentHouseholdId, d, d.id && d.updated_at ? d.updated_at : undefined);
    const idx = debts.findIndex(x => x.id === saved.id);
    set({ debts: idx >= 0 ? debts.map(x => x.id === saved.id ? saved as Debt : x) : [...debts, saved as Debt] });
    return saved as Debt;
  },
  removeDebt: async (id) => {
    const { adapter, currentHouseholdId, debts } = get();
    await adapter.remove('debts', currentHouseholdId, id);
    set({ debts: debts.filter(x => x.id !== id) });
  },
  upsertAsset: async (a) => {
    const { adapter, currentHouseholdId, assets } = get();
    // TD-03 phase B (PR #12): thread the version precondition on edits.
    const saved = await adapter.upsert('assets', currentHouseholdId, a, a.id && a.updated_at ? a.updated_at : undefined);
    const idx = assets.findIndex(x => x.id === saved.id);
    set({ assets: idx >= 0 ? assets.map(x => x.id === saved.id ? saved as Asset : x) : [...assets, saved as Asset] });
    return saved as Asset;
  },
  removeAsset: async (id) => {
    const { adapter, currentHouseholdId, assets } = get();
    await adapter.remove('assets', currentHouseholdId, id);
    set({ assets: assets.filter(x => x.id !== id) });
  },
  upsertAccount: async (a) => {
    const { adapter, currentHouseholdId, accounts } = get();
    const isNew = !a.id || !accounts.find(x => x.id === a.id);

    // v9.4.2 — when creating a NEW investment account with no backing asset,
    // auto-create a corresponding Asset so the investment appears on Net Worth.
    // The `assetId` FK chain (accountValueOf → 'asset:<assetId>') feeds balances
    // into the Net Worth calculation automatically.
    if (isNew && a.kind === 'investment' && !a.assetId) {
      const backingAsset = await get().upsertAsset({
        id: uid(),
        type: 'investment',
        name: a.name || 'Investment',
        value: (a as any).openingBalance || 0,
        currency: a.currency || get().profile.baseCurrency,
        liquidity: 'short',
      });
      a = { ...a, assetId: backingAsset.id };
    }

    const saved = await adapter.upsert('accounts', currentHouseholdId, a, a.id && a.updated_at ? a.updated_at : undefined);
    const idx = accounts.findIndex(x => x.id === saved.id);
    set({ accounts: idx >= 0 ? accounts.map(x => x.id === saved.id ? saved as Account : x) : [...accounts, saved as Account] });
    return saved as Account;
  },
  removeAccount: async (id) => {
    const { adapter, currentHouseholdId, accounts } = get();
    await adapter.remove('accounts', currentHouseholdId, id);
    set({ accounts: accounts.filter(x => x.id !== id) });
  },
  upsertSavedView: async (v) => {
    const { adapter, currentHouseholdId, savedViews } = get();
    const saved = await adapter.upsert('savedViews', currentHouseholdId, v, v.id && v.updated_at ? v.updated_at : undefined);
    const idx = savedViews.findIndex(x => x.id === saved.id);
    set({ savedViews: idx >= 0 ? savedViews.map(x => x.id === saved.id ? saved as SavedView : x) : [...savedViews, saved as SavedView] });
    return saved as SavedView;
  },
  removeSavedView: async (id) => {
    const { adapter, currentHouseholdId, savedViews } = get();
    await adapter.remove('savedViews', currentHouseholdId, id);
    set({ savedViews: savedViews.filter(x => x.id !== id) });
  },
});
