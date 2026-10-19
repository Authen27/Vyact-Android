// Vyact — entity CRUD slice (TD-25 sub-split of the data core).
//
// The repetitive household-scoped entity writes (budget / allocation / goal /
// member / debt / asset / account / saved-view). Each persists via the adapter
// then updates the in-memory array; no money-math (the money-critical
// upsertTransaction / recordDebtPayment stay in dataSlice). Moved verbatim;
// reads/writes the rest of the store via get()/set().
import type { StateCreator } from 'zustand';
import type { Store } from '../../store';
import type {
  Budget, BudgetAllocation, Goal, Member, Debt, Asset, Account, SavedView,
  AccountDependencies, AccountMoveResult, Transaction, RecurringSchedule,
} from '../../types';
import { uid } from '../../lib/format';
import { can } from '../../lib/permissions';
import { track } from '../../lib/analytics';
import { hasDependencies, localAccountDependencies, loansRecordingFrom, moveDestinations } from '../../lib/accountsView';
import { withRow, withRows, withoutRow } from '../../lib/rowMerge';
import { landIn } from '../landIn';

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  /** Onboarding-only: create the join-month budget while the household is being
   *  set up. Skips the owner/admin role guard because the onboarding user is,
   *  by definition, the owner setting up their OWN household — and in
   *  local-only mode `myRole` is never populated. Best-effort; identical write
   *  path as `saveBudgetWithAllocations` otherwise. */
  saveOnboardingBudget: (budget: Partial<Budget>, allocations: Partial<BudgetAllocation>[]) => Promise<void>;
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
  /** v10.24.0 (R2) — what refers to an account: the database's count in cloud
   *  mode (a cached answer could be stale), the store's in local-only mode. */
  accountDependencies: (id: string) => Promise<AccountDependencies>;
  /** v10.24.0 (R2) — permanent delete, refused while anything refers to the account. */
  deleteAccountPermanently: (id: string) => Promise<void>;
  /** v10.24.0 (R2) — re-tag every transaction and schedule to another account of
   *  the same group, fold the source's opening balance + offset into it, then
   *  delete the source. No balance, category total or net worth moves. */
  moveAccountAndDelete: (fromId: string, toId: string) => Promise<AccountMoveResult>;
  /** Idempotent — creates the household's one default Cash account (at $0) if
   *  it doesn't already have one. Safe to call on every load. */
  ensureDefaultCashAccount: () => Promise<void>;
  upsertSavedView: (v: Partial<SavedView>) => Promise<SavedView>;
  removeSavedView: (id: string) => Promise<void>;
}

export const createCrudSlice: StateCreator<Store, [], [], CrudSlice> = (set, get) => {
  // T5b (v10.121.0; audit XC-ARC-10) — a write after an await lands only in the household it was made for.
  const commit = landIn(set, get);
  return ({
  upsertBudget: async (b) => {
    assertCanManageBudgets(get().myRole);
    const { adapter, currentHouseholdId } = get();
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
    // F1b (FE-SYN-06): every write below lands in the CURRENT list, never in one read before its await.
    commit(currentHouseholdId, s => ({ budgets: withRow(s.budgets, merged) }));
    return merged;
  },
  removeBudget: async (id) => {
    assertCanManageBudgets(get().myRole);
    const { adapter, currentHouseholdId } = get();
    await adapter.remove('budgets', currentHouseholdId, id);
    // Cascade allocations locally (DB cascades via FK on delete; soft-delete
    // here just drops them from memory).
    commit(currentHouseholdId, s => ({
      budgets: withoutRow(s.budgets, id),
      budgetAllocations: s.budgetAllocations.filter(a => a.budgetId !== id),
    }));
  },
  // Budget-sync fix — atomic budget + allocations save via one online RPC. This is
  // the durable path the form uses (replaces the old upsertBudget + per-row
  // setBudgetAllocations two-step, whose child writes could silently dead-letter).
  saveBudgetWithAllocations: async (budget, allocs) => {
    assertCanManageBudgets(get().myRole);
    const { adapter, currentHouseholdId } = get();
    const mode: 'create' | 'replace' = budget.id ? 'replace' : 'create';
    const { budget: saved, allocations } = await adapter.upsertBudgetWithAllocations(currentHouseholdId, budget, allocs, mode);
    if (mode === 'create') track('budget_created', { surface: 'budgets', count: allocations.length });
    const merged: Budget = { ...saved, period: saved.period || budget.period || 'monthly' };
    commit(currentHouseholdId, s => ({
      budgets: withRow(s.budgets, merged),
      budgetAllocations: [...s.budgetAllocations.filter(a => a.budgetId !== saved.id), ...allocations],
    }));
    return { budget: merged, allocations };
  },
  saveOnboardingBudget: async (budget, allocs) => {
    // No role assert (see interface). Same atomic write path + state merge as
    // saveBudgetWithAllocations, but always a create.
    const { adapter, currentHouseholdId } = get();
    const { budget: saved, allocations } = await adapter.upsertBudgetWithAllocations(
      currentHouseholdId, budget, allocs, 'create',
    );
    track('budget_created', { surface: 'onboarding', count: allocations.length });
    const merged: Budget = { ...saved, period: saved.period || budget.period || 'monthly' };
    commit(currentHouseholdId, s => ({
      budgets: withRow(s.budgets, merged),
      budgetAllocations: [...s.budgetAllocations.filter(a => a.budgetId !== saved.id), ...allocations],
    }));
  },
  // v9.1 §4 — replace the full per-category allocation set for one budget.
  setBudgetAllocations: async (budgetId, rows) => {
    assertCanManageBudgets(get().myRole);
    const { adapter, currentHouseholdId, budgetAllocations } = get();
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
    commit(currentHouseholdId, s => ({ budgetAllocations: [...s.budgetAllocations.filter(a => a.budgetId !== budgetId), ...saved] }));
    return saved;
  },
  upsertGoal: async (g) => {
    const { adapter, currentHouseholdId } = get();
    // TD-03 phase B (PR #12): thread the version precondition on edits.
    const saved = await adapter.upsert('goals', currentHouseholdId, g, g.id && g.updated_at ? g.updated_at : undefined);
    commit(currentHouseholdId, s => ({ goals: withRow(s.goals, saved as Goal) }));
    return saved as Goal;
  },
  removeGoal: async (id) => {
    const { adapter, currentHouseholdId } = get();
    await adapter.remove('goals', currentHouseholdId, id);
    commit(currentHouseholdId, s => ({ goals: withoutRow(s.goals, id) }));
  },
  upsertMember: async (m) => {
    const { adapter, currentHouseholdId } = get();
    const saved = await adapter.upsert('members', currentHouseholdId, m);
    commit(currentHouseholdId, s => ({ members: withRow(s.members, saved as Member) }));
    return saved as Member;
  },
  removeMember: async (id) => {
    const { adapter, currentHouseholdId, transactions } = get();
    // Orphan linked transactions
    const linked = transactions.filter(t => t.memberId === id);
    for (const t of linked) {
      const updated = { ...t, memberId: '' };
      await adapter.upsert('transactions', currentHouseholdId, updated);
    }
    await adapter.remove('members', currentHouseholdId, id);
    commit(currentHouseholdId, s => ({
      members: withoutRow(s.members, id),
      transactions: s.transactions.map(t => t.memberId === id ? { ...t, memberId: '' } : t),
    }));
  },
  upsertDebt: async (d) => {
    const { adapter, currentHouseholdId } = get();
    // TD-03 phase B (PR #12): thread the version precondition on edits.
    const saved = await adapter.upsert('debts', currentHouseholdId, d, d.id && d.updated_at ? d.updated_at : undefined);
    commit(currentHouseholdId, s => ({ debts: withRow(s.debts, saved as Debt) }));
    return saved as Debt;
  },
  // W4f (D17) — a loan with money owed cannot be deleted; the rule lives in deleteDebt (and the database).
  removeDebt: async (id) => {
    await get().deleteDebt(id);
  },
  upsertAsset: async (a) => {
    const { adapter, currentHouseholdId } = get();
    // TD-03 phase B (PR #12): thread the version precondition on edits.
    const saved = await adapter.upsert('assets', currentHouseholdId, a, a.id && a.updated_at ? a.updated_at : undefined);
    commit(currentHouseholdId, s => ({ assets: withRow(s.assets, saved as Asset) }));
    return saved as Asset;
  },
  removeAsset: async (id) => {
    const { adapter, currentHouseholdId, transactions } = get();
    // v10.26.0 (R4) — an investment asset its buys still point at cannot go:
    // its value would leave net worth while the paying accounts stay debited.
    // The database refuses the same (assets_refuse_delete_in_use).
    if (transactions.some(t => t.type === 'investment' && t.assetId === id)) {
      throw new Error('This investment has buys or withdrawals recorded against it — delete or move those first.');
    }
    await adapter.remove('assets', currentHouseholdId, id);
    commit(currentHouseholdId, s => ({ assets: withoutRow(s.assets, id) }));
  },
  upsertAccount: async (a) => {
    const { adapter, currentHouseholdId, accounts } = get();
    const isNew = !a.id || !accounts.find(x => x.id === a.id);

    // Exactly one Cash account per household. accountValueOf() encodes EVERY
    // cash-kind account to the same literal 'cash' key, so a second one would
    // double-count every cash transaction into both balances (and Net Worth)
    // rather than just being an odd duplicate — this is a correctness guard,
    // not a cosmetic one. (Net Worth no longer needs a backing Asset per
    // account — it reads each account's live balance directly; see
    // lib/accountBalance.ts `liveAssetRows`.)
    if (isNew && a.kind === 'cash' && accounts.some(x => x.kind === 'cash' && x.id !== a.id)) {
      throw new Error('This household already has a Cash account — edit it instead of adding another.');
    }
    // v10.23.0 (R1) — nor can it be archived. An archived cash account still
    // holds the household's one cash slot, but disappears from every picker, so
    // cash spend and income would be left with nowhere to post.
    if ((accounts.find(x => x.id === a.id)?.kind ?? a.kind) === 'cash' && a.isArchived === true) {
      throw new Error('Cash in Hand cannot be archived — every household keeps exactly one.');
    }
    // v10.119.0 (owner, 19 Oct 2026) — nor can an account a loan records its EMIs from: the payment would be
    // refused and the EMI would go unrecorded without a word. The database refuses it too
    // (accounts_guard_lifecycle); this says why before anything is written.
    if (a.id && a.isArchived === true && !accounts.find(x => x.id === a.id)?.isArchived) {
      const loans = loansRecordingFrom(a.id, get().debts);
      if (loans.length) {
        const names = loans.map(l => l.name).join(', ');
        throw new Error(`${names} ${loans.length === 1 ? 'records its EMIs' : 'record their EMIs'} from this account. `
          + `Change ${loans.length === 1 ? 'its' : 'their'} paying account first.`);
      }
    }

    // 🔒 A PATCH MUST NOT ERASE WHAT IT DOES NOT MENTION.
    //
    // Callers legitimately send partials: the account editor sends metadata
    // only (name/kind/currency/flags), while reconcile sends `{...account,
    // ...patch}`. The editor's shape used to reach an adapter that treats the
    // record as complete — the local one replaces it outright, the cloud one
    // defaulted the missing financial columns to 0 — so a rename wrote away the
    // opening balance and the reconciliation history.
    //
    // Merging here, at the layer that actually knows what an Account is, fixes
    // both adapters at once and keeps the generic `upsert` semantics untouched:
    // changing those globally would silently alter every other entity, and some
    // callers do rely on passing a full record.
    //
    // Only DEFINED keys are merged, so an explicit `undefined` in a patch still
    // cannot resurrect an old value by accident.
    const existing = a.id ? accounts.find(x => x.id === a.id) : undefined;
    const merged: Partial<Account> = existing
      ? { ...existing, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) }
      : a;
    // v10.23.0 (R1) — currency is the HOUSEHOLD's, never the account's. The
    // cloud enforces it with a trigger (accounts_currency_from_household);
    // stamping it here keeps local-only mode and the optimistic cache telling
    // the same truth, whatever the caller sent.
    const payload: Partial<Account> = { ...merged, currency: get().profile.baseCurrency };

    const saved = await adapter.upsert('accounts', currentHouseholdId, payload, payload.id && payload.updated_at ? payload.updated_at : undefined) as Account;

    // v10.24.0 — ONE default account per household. The cloud clears the old
    // default in the same statement (accounts_single_default trigger); mirror
    // that here so the cache never shows two ★ rows until the next refresh. In
    // local-only mode the store IS the database, so the cleared rows are
    // written through as well.
    const makesDefault = !!saved.isDefault && !saved.isArchived;
    if (makesDefault && !(get().cloudEnabled && currentHouseholdId !== 'local')) {
      const demoted = get().accounts.filter(x => x.id !== saved.id && x.isDefault).map(x => ({ ...x, isDefault: false }));
      for (const d of demoted) await adapter.upsert('accounts', currentHouseholdId, d);
    }
    // F1b (FE-SYN-06): into the CURRENT list (one read before the awaits would undo a refresh).
    commit(currentHouseholdId, s => ({
      accounts: withRow(s.accounts, saved)
        .map(x => (makesDefault && x.id !== saved.id && x.isDefault ? { ...x, isDefault: false } : x)),
    }));
    return saved;
  },
  removeAccount: async (id) => {
    const { adapter, currentHouseholdId, accounts } = get();
    // v10.23.0 (R1) — Cash in Hand is system-managed: cash spend and income
    // need somewhere to post, and the next load would simply create it again.
    if (accounts.find(x => x.id === id)?.kind === 'cash') {
      throw new Error('Cash in Hand cannot be deleted — every household keeps exactly one.');
    }
    await adapter.remove('accounts', currentHouseholdId, id);
    commit(currentHouseholdId, s => ({ accounts: withoutRow(s.accounts, id) }));
  },
  accountDependencies: async (id) => {
    const { adapter, currentHouseholdId, cloudEnabled, transactions, recurringSchedules } = get();
    if (cloudEnabled && currentHouseholdId !== 'local' && typeof adapter.accountDependencies === 'function') {
      return adapter.accountDependencies(currentHouseholdId, id);
    }
    return localAccountDependencies(id, transactions, recurringSchedules, get().debts);
  },
  deleteAccountPermanently: async (id) => {
    const { adapter, currentHouseholdId, cloudEnabled, accounts } = get();
    const account = accounts.find(x => x.id === id);
    if (!account) return;
    if (account.kind === 'cash') {
      throw new Error('Cash in Hand cannot be deleted — every household keeps exactly one.');
    }
    if (cloudEnabled && currentHouseholdId !== 'local' && typeof adapter.deleteAccountGuarded === 'function') {
      // The database counts and refuses; the client never decides alone.
      await adapter.deleteAccountGuarded(currentHouseholdId, id);
    } else {
      if (hasDependencies(await get().accountDependencies(id))) {
        throw new Error('This account has history attached — archive it, or move its history first.');
      }
      // v10.119.0 — as delete_account does: a loan that does not record automatically only had this as its
      // default paying account.
      for (const d of get().debts.filter(x => x.fundingAccountId === id)) {
        await get().upsertDebt({ ...d, fundingAccountId: undefined });
      }
      await adapter.remove('accounts', currentHouseholdId, id);
    }
    commit(currentHouseholdId, { accounts: get().accounts.filter(x => x.id !== id) });
  },
  moveAccountAndDelete: async (fromId, toId) => {
    const { adapter, currentHouseholdId, cloudEnabled, accounts } = get();
    const source = accounts.find(a => a.id === fromId);
    const target = accounts.find(a => a.id === toId);
    if (!source || !target) throw new Error('Account not found.');
    if (source.kind === 'cash') throw new Error('Cash in Hand cannot be deleted — every household keeps exactly one.');
    if (!moveDestinations(source, accounts).some(a => a.id === toId)) {
      throw new Error('History can only move to another active account of the same type.');
    }

    if (cloudEnabled && currentHouseholdId !== 'local' && typeof adapter.moveAccountAndDelete === 'function') {
      // One database transaction moves the rows, folds the balance and tombstones
      // the source; refresh pulls back everything it changed.
      const result = await adapter.moveAccountAndDelete(currentHouseholdId, fromId, toId);
      commit(currentHouseholdId, { accounts: get().accounts.filter(a => a.id !== fromId) });
      await get().refresh();
      return result;
    }

    // Local-only: the same steps the RPC performs, against the store.
    const { transactions, recurringSchedules } = get();
    if (transactions.some(t => (t.accountId === fromId && t.toAccountId === toId)
                            || (t.accountId === toId && t.toAccountId === fromId))) {
      throw new Error('Transfers run between these two accounts — moving would turn them into transfers to itself.');
    }
    const movedTxns: Transaction[] = transactions
      .filter(t => t.accountId === fromId || t.toAccountId === fromId)
      .map(t => ({
        ...t,
        accountId: t.accountId === fromId ? toId : t.accountId,
        toAccountId: t.toAccountId === fromId ? toId : t.toAccountId,
      }));
    const movedSchedules: RecurringSchedule[] = recurringSchedules
      .filter(s => s.transactionTemplate.accountId === fromId || s.transactionTemplate.toAccountId === fromId)
      .map(s => ({
        ...s,
        transactionTemplate: {
          ...s.transactionTemplate,
          accountId: s.transactionTemplate.accountId === fromId ? toId : s.transactionTemplate.accountId,
          toAccountId: s.transactionTemplate.toAccountId === fromId ? toId : s.transactionTemplate.toAccountId,
        },
      }));
    // v10.119.0 — the loans paid from it are paid from the destination now, as the RPC does.
    const movedDebts: Debt[] = get().debts
      .filter(d => d.fundingAccountId === fromId)
      .map(d => ({ ...d, fundingAccountId: toId }));
    for (const t of movedTxns) await adapter.upsert('transactions', currentHouseholdId, t);
    for (const s of movedSchedules) await adapter.upsert('recurring', currentHouseholdId, s);
    for (const d of movedDebts) await adapter.upsert('debts', currentHouseholdId, d);
    commit(currentHouseholdId, state => ({
      transactions: withRows(state.transactions, movedTxns),
      recurringSchedules: withRows(state.recurringSchedules, movedSchedules),
      debts: withRows(state.debts, movedDebts),
    }));

    const folded = round2((source.openingBalance ?? 0) + (source.reconciliationOffset ?? 0));
    if (folded !== 0) {
      await get().upsertAccount({
        id: toId,
        reconciliationOffset: round2((target.reconciliationOffset ?? 0) + folded),
        reconciliationLog: [...(target.reconciliationLog ?? []), {
          at: new Date().toISOString(), delta: folded, kind: 'merge', stated_value: null,
          note: `Moved from ${source.name}`,
        }],
      });
    }
    await adapter.remove('accounts', currentHouseholdId, fromId);
    commit(currentHouseholdId, { accounts: get().accounts.filter(a => a.id !== fromId) });
    return { status: 'moved', transactions: movedTxns.length, schedules: movedSchedules.length, folded };
  },
  // Every household gets exactly one default Cash account, even at $0 — cash
  // spend/income needs somewhere to post to from day one, and Net Worth's
  // asset side folds it in like any other account. Idempotent: a no-op once
  // one exists (archived or not — recreating a duplicate would double-count,
  // see upsertAccount above), so it's safe to call on every app/household load.
  ensureDefaultCashAccount: async () => {
    const { accounts, profile, adapter, cloudEnabled, currentHouseholdId } = get();

    // 🔴 v10.23.0 (R1) — IN CLOUD MODE THE SERVER DECIDES.
    //
    // The check below used to run in cloud mode too. It asks "does the LOCAL
    // store hold a cash account?", and on a cold start or a household switch it
    // could run before the store had hydrated — so the answer was "no", and it
    // wrote a brand-new "Cash in Hand" beside the household's real one. It also
    // took its currency from profile.baseCurrency, which is 'USD' until the
    // profile loads. Production accumulated exactly that: empty USD duplicates
    // inside an INR household, each one double-counting every cash transaction.
    //
    // The database now owns the identity (uq_account_cash_per_household), and
    // ensure_cash_account creates-or-returns atomically. The store only ever
    // ASKS in cloud mode; it never inserts.
    if (cloudEnabled && currentHouseholdId && currentHouseholdId !== 'local') {
      if (typeof adapter.ensureCashAccount !== 'function') return;
      const cash = await adapter.ensureCashAccount(currentHouseholdId);
      // A household switch while the call was in flight: this row belongs to
      // the previous household and must not land in the new one's store.
      if (!cash || get().currentHouseholdId !== currentHouseholdId) return;
      set({ accounts: [...get().accounts.filter(x => x.id !== cash.id && x.kind !== 'cash'), cash] });
      return;
    }

    // Local-only mode: the store IS the database, so the local check is sound.
    if (accounts.some(x => x.kind === 'cash')) return;
    await get().upsertAccount({
      id: uid(),
      kind: 'cash',
      name: 'Cash in Hand',
      currency: profile.baseCurrency,
      // Same rule as ensure_cash_account: Cash becomes the default only when
      // the household has none — never a second ★ beside an existing default.
      isDefault: !accounts.some(x => x.isDefault && !x.isArchived),
      openingBalance: 0,
    });
  },
  upsertSavedView: async (v) => {
    const { adapter, currentHouseholdId } = get();
    const saved = await adapter.upsert('savedViews', currentHouseholdId, v, v.id && v.updated_at ? v.updated_at : undefined);
    commit(currentHouseholdId, s => ({ savedViews: withRow(s.savedViews, saved as SavedView) }));
    return saved as SavedView;
  },
  removeSavedView: async (id) => {
    const { adapter, currentHouseholdId } = get();
    await adapter.remove('savedViews', currentHouseholdId, id);
    commit(currentHouseholdId, s => ({ savedViews: withoutRow(s.savedViews, id) }));
  },
});
};
