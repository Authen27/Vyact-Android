// Vyact v6 — TypeScript DataAdapter
// LocalStorageAdapter is the active impl; SupabaseAdapter is reserved
// for the cloud phase. The interface lets us swap with one line in main.tsx.
//
// Backward-compat: anonymous-mode uses legacy v4/v5 storage keys so existing data survives.

import type {
  Transaction, Budget, BudgetAllocation, Goal, Member, Debt, Asset, Account, SavedView,
  Profile, ExchangeRates, HouseholdMeta, ProfileTypeKey,
} from '../types';
import { DEFAULT_RATES } from '../constants';
import { uid } from './format';
import ls from './localStorageCompat';
// TD-14 — bulk entity state lives in IndexedDB (kvStore) to escape the
// ~5 MB localStorage ceiling. Small string keys (active_profile, theme,
// migration sentinels) still go through `ls` directly: tiny payloads,
// no quota risk, and they need synchronous access from constructor /
// startup paths.
import { kvGet, kvSet, kvRemove } from './kvStore';
import { BudgetExistsError } from './supabaseAdapter';
import { expected } from './faults';

// v7.1.2 — `accounts` becomes a first-class entity. The cloud table
// already exists (Money Map Phase 1 migration); the LocalStorage adapter
// just gets its own bucket.
// v7.3.0 — `savedViews` joins as a first-class entity (Money Map Item #4).
//          Backed by `saved_views` table + `replace_saved_views` RPC.
export type Entity =
  | 'transactions' | 'budgets' | 'goals' | 'debts' | 'assets'
  | 'members' | 'accounts' | 'savedViews' | 'recurring'
  | 'budgetAllocations';   // v9.1 §4 — cloud-synced budget sub-limits

export interface DataAdapter {
  // households / profiles
  listHouseholds(): Promise<HouseholdMeta[]>;
  createHousehold(name: string, type: ProfileTypeKey, baseCurrency?: string): Promise<HouseholdMeta>;
  updateHousehold(id: string, patch: Partial<HouseholdMeta>): Promise<HouseholdMeta>;
  deleteHousehold(id: string): Promise<void>;
  getActiveHousehold(): Promise<string>;
  setActiveHousehold(id: string): Promise<string>;

  // profile (per-household)
  getProfile(householdId: string): Promise<Profile | null>;
  updateProfile(householdId: string, patch: Partial<Profile>): Promise<Profile>;

  // generic domain CRUD
  list<T = unknown>(entity: Entity, householdId: string): Promise<T[]>;
  /**
   * Insert-or-update a record.
   *
   * TD-03 (optimistic concurrency): when `expectedUpdatedAt` is supplied
   * AND `record.id` is set, the cloud adapter performs a compare-and-set
   * UPDATE — `WHERE id = ? AND updated_at = ?`. If zero rows match (a
   * concurrent edit on the same row has bumped `updated_at` since the
   * caller's read), the adapter throws `ConcurrencyConflictError` and
   * the queue dead-letters the op for surfacing in the UI. When
   * `expectedUpdatedAt` is omitted, behaviour is the legacy upsert
   * (insert-or-replace by id) and last-write-wins.
   */
  upsert<T extends { id?: string } = { id?: string }>(entity: Entity, householdId: string, record: T, expectedUpdatedAt?: string): Promise<T & { id: string }>;
  remove(entity: Entity, householdId: string, id: string): Promise<void>;
  replaceAll<T = unknown>(entity: Entity, householdId: string, records: T[]): Promise<T[]>;
  /**
   * Create a budget for its identity slot (household, scope, period), enforcing
   * one-per-slot at the source of truth. Throws `BudgetExistsError` when a live
   * budget already exists for that period — including one another member just
   * created that this device hasn't pulled. Unlike the optimistic `upsert`, this
   * is an online, synchronous check (budgets are period singletons that need
   * household-wide coordination). The DB assigns the id.
   */
  createBudgetChecked(householdId: string, budget: Partial<Budget>): Promise<Budget>;
  /**
   * Budget-sync fix: write a budget AND its full per-category allocation set in a
   * SINGLE atomic, online-synchronous operation (DB RPC `upsert_budget_with_allocations`).
   * Fixes the defect where allocations went through the fire-and-forget queue and
   * could silently dead-letter — never reaching the cloud for realtime/other devices.
   * `mode='create'` enforces one-budget-per-slot (throws `BudgetExistsError`);
   * `mode='replace'` updates the existing budget. Returns the authoritative rows.
   */
  upsertBudgetWithAllocations(
    householdId: string,
    budget: Partial<Budget>,
    allocations: Partial<BudgetAllocation>[],
    mode: 'create' | 'replace',
  ): Promise<{ budget: Budget; allocations: BudgetAllocation[] }>;

  // exchange rates (per-household)
  getRates(householdId: string): Promise<ExchangeRates>;
  upsertRate(householdId: string, code: string, rate: number): Promise<void>;

  /** v7.3 — Money Map Item #8 read-path optimisation. Optional. When
   *  the adapter exposes pre-aggregated `v_txn_by_member` /
   *  `v_txn_by_account` views, callers can avoid downloading every txn
   *  for breakout charts. Adapters that don't implement these (or fail
   *  / are offline) return undefined and the caller folds client-side
   *  as before. */
  queryTxnByMember?(householdId: string): Promise<Array<{ member_id: string | null; type: string; currency: string; total: number; n: number }> | undefined>;
  queryTxnByAccount?(householdId: string): Promise<Array<{ account_id: string | null; type: string; currency: string; total: number; n: number }> | undefined>;
}

const ANON = 'local';

export class LocalStorageAdapter implements DataAdapter {
  constructor() {
    // Run a one-time anon-key migration (legacy -> vt_) where appropriate.
    // This is intentionally best-effort and idempotent.
    try { this.migrateAnonKeys(); } catch { /* noop */ }
  }

  private async read<T>(suffix: string, householdId: string, fallback: T): Promise<T> {
    try {
      const key = householdId === ANON ? suffix : `${householdId}_${suffix}`;
      const v = await kvGet<T>(key);
      return v !== null && v !== undefined ? v : fallback;
    } catch (e) { expected(e, `localAdapter.read:${suffix}`); return fallback; }
  }
  private async write<T>(suffix: string, householdId: string, value: T): Promise<void> {
    try {
      const key = householdId === ANON ? suffix : `${householdId}_${suffix}`;
      await kvSet(key, value);
    } catch (e) { expected(e, `localAdapter.write:${suffix}`); } // kvSet already classifies/surfaces its own failures
  }
  private async removeBoth(suffix: string, householdId: string): Promise<void> {
    try {
      const key = householdId === ANON ? suffix : `${householdId}_${suffix}`;
      await kvRemove(key);
    } catch (e) { expected(e, `localAdapter.removeBoth:${suffix}`); }
  }

  // One-time migration for anonymous (local) keys from legacy -> vt_.
  private migrateAnonKeys(): void {
    try {
      // Guard so we only attempt this once per device
      try { if (ls.readString('migrated_v1') === '1') return; } catch { /* continue */ }
      const anonKeys = [
        'transactions','budgets','goals','members','debts','assets','rates','profile',
        'profiles_list','active_profile','recurring','notifications','notification_prefs',
        'theme','last_backup','chat_history','budget_periods'
      ];
      for (const s of anonKeys) {
        try {
          const nk = ls.newKey(s);
          const lk = ls.legacyKey(s);
          if (localStorage.getItem(nk) === null) {
            const v = localStorage.getItem(lk);
            if (v !== null) {
              try { localStorage.setItem(nk, v); } catch { /* noop */ }
            }
          }
        } catch { /* continue */ }
      }
      try { ls.setString('migrated_v1', '1'); } catch { /* noop */ }
    } catch { /* noop */ }
  }

  // ── households ────────────────────────────────────────────────
  async listHouseholds(): Promise<HouseholdMeta[]> {
    const list = await this.read<HouseholdMeta[]>('profiles_list', ANON, []);
    if (!list || !Array.isArray(list) || list.length === 0) {
      const def: HouseholdMeta[] = [{
        id: ANON, name: 'My Household', type: 'family',
        baseCurrency: 'USD', createdAt: new Date().toISOString(),
      }];
      await this.write('profiles_list', ANON, def);
      return def;
    }
    return list;
  }
  async createHousehold(name: string, type: ProfileTypeKey = 'personal', baseCurrency = 'USD'): Promise<HouseholdMeta> {
    const list = await this.listHouseholds();
    const meta: HouseholdMeta = {
      id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, type, baseCurrency, createdAt: new Date().toISOString(),
    };
    list.push(meta);
    await this.write('profiles_list', ANON, list);
    return meta;
  }
  async updateHousehold(id: string, patch: Partial<HouseholdMeta>): Promise<HouseholdMeta> {
    const list = await this.listHouseholds();
    const idx = list.findIndex(h => h.id === id);
    if (idx < 0) throw new Error('Household not found');
    list[idx] = { ...list[idx], ...patch };
    await this.write('profiles_list', ANON, list);
    return list[idx];
  }
  async deleteHousehold(id: string): Promise<void> {
    if (id === ANON) throw new Error('Cannot delete the default profile');
    await Promise.all(
      ['transactions','budgets','goals','members','debts','assets','accounts','savedViews','rates','profile']
        .map(e => this.removeBoth(e, id))
    );
    const list = (await this.listHouseholds()).filter(h => h.id !== id);
    await this.write('profiles_list', ANON, list);
  }
  async getActiveHousehold(): Promise<string> {
    try { const v = ls.readString('active_profile'); if (v) return v; } catch { /* noop */ }
    return ANON;
  }
  async setActiveHousehold(id: string): Promise<string> {
    try { ls.setString('active_profile', id); } catch { /* noop */ }
    return id;
  }

  // ── profile ──────────────────────────────────────────────────
  async getProfile(householdId: string): Promise<Profile | null> {
    return this.read<Profile | null>('profile', householdId, null);
  }
  async updateProfile(householdId: string, patch: Partial<Profile>): Promise<Profile> {
    const cur = (await this.getProfile(householdId)) ?? {
      name: '', email: '', baseCurrency: 'USD', language: 'en',
      household: 'family', dateFormat: 'us', payoffStrategy: 'avalanche', extraPayment: 0,
    };
    const next = { ...cur, ...patch };
    await this.write('profile', householdId, next);
    return next;
  }

  // ── generic CRUD ─────────────────────────────────────────────
  async list<T = unknown>(entity: Entity, householdId: string): Promise<T[]> {
    return this.read<T[]>(entity, householdId, []);
  }
  async upsert<T extends { id?: string } = { id?: string }>(entity: Entity, householdId: string, record: T, _expectedUpdatedAt?: string): Promise<T & { id: string }> {
    // LocalStorageAdapter is single-user / single-tab; concurrency conflicts
    // can't occur here, so `_expectedUpdatedAt` is accepted for interface
    // parity with SupabaseAdapter and intentionally ignored.
    const list = await this.read<(T & { id: string })[]>(entity, householdId, []);
    const id = record.id || uid();
    const next = { ...record, id, updated_at: new Date().toISOString() } as T & { id: string };
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) list[idx] = next; else list.push(next);
    await this.write(entity, householdId, list);
    return next;
  }
  async remove(entity: Entity, householdId: string, id: string): Promise<void> {
    const list = await this.read<{ id: string }[]>(entity, householdId, []);
    await this.write(entity, householdId, list.filter(r => r.id !== id));
  }
  async createBudgetChecked(householdId: string, budget: Partial<Budget>): Promise<Budget> {
    // Local mirror of the DB authority: reject a second budget for the same slot.
    const list = await this.read<Budget[]>('budgets', householdId, []);
    const clash = list.some(b => b.scope === budget.scope && b.periodYear === budget.periodYear
      && (budget.scope === 'month' ? b.periodMonth === budget.periodMonth : true));
    if (clash) throw new BudgetExistsError(`scope=${budget.scope} year=${budget.periodYear}${budget.scope === 'month' ? ` month=${budget.periodMonth}` : ''}`);
    return await this.upsert('budgets', householdId, { ...budget, id: uid() }) as Budget;
  }
  async upsertBudgetWithAllocations(
    householdId: string,
    budget: Partial<Budget>,
    allocations: Partial<BudgetAllocation>[],
    mode: 'create' | 'replace',
  ): Promise<{ budget: Budget; allocations: BudgetAllocation[] }> {
    // Local-only equivalent of the atomic RPC: dedup-check on create, then a
    // scoped replace of this budget's allocation set (no cross-budget delete).
    const saved = (mode === 'create' && !budget.id)
      ? await this.createBudgetChecked(householdId, budget)
      : await this.upsert('budgets', householdId, budget) as Budget;
    const all = await this.read<BudgetAllocation[]>('budgetAllocations', householdId, []);
    const others = all.filter(a => a.budgetId !== saved.id);
    const fresh: BudgetAllocation[] = allocations
      .filter(a => (a.category ?? '') !== '')
      .map(a => ({ id: uid(), budgetId: saved.id, category: a.category!, amount: a.amount ?? 0 }));
    await this.write('budgetAllocations', householdId, [...others, ...fresh]);
    return { budget: saved, allocations: fresh };
  }
  async replaceAll<T = unknown>(entity: Entity, householdId: string, records: T[]): Promise<T[]> {
    await this.write(entity, householdId, records);
    return records;
  }

  // ── rates ────────────────────────────────────────────────────
  async getRates(householdId: string): Promise<ExchangeRates> {
    return { ...DEFAULT_RATES, ...(await this.read<ExchangeRates>('rates', householdId, {})) };
  }
  async upsertRate(householdId: string, code: string, rate: number): Promise<void> {
    const rates = await this.read<ExchangeRates>('rates', householdId, {});
    rates[code] = rate;
    await this.write('rates', householdId, rates);
  }
}

// Convenience typed listers (for store)
export interface TypedListers {
  listTransactions(adapter: DataAdapter, h: string): Promise<Transaction[]>;
  listBudgets(adapter: DataAdapter, h: string): Promise<Budget[]>;
  listGoals(adapter: DataAdapter, h: string): Promise<Goal[]>;
  listMembers(adapter: DataAdapter, h: string): Promise<Member[]>;
  listDebts(adapter: DataAdapter, h: string): Promise<Debt[]>;
  listAssets(adapter: DataAdapter, h: string): Promise<Asset[]>;
  listAccounts(adapter: DataAdapter, h: string): Promise<Account[]>;
  listSavedViews(adapter: DataAdapter, h: string): Promise<SavedView[]>;
}

export const typed: TypedListers = {
  listTransactions: (a, h) => a.list<Transaction>('transactions', h),
  listBudgets:      (a, h) => a.list<Budget>('budgets', h),
  listGoals:        (a, h) => a.list<Goal>('goals', h),
  listMembers:      (a, h) => a.list<Member>('members', h),
  listDebts:        (a, h) => a.list<Debt>('debts', h),
  listAssets:       (a, h) => a.list<Asset>('assets', h),
  listAccounts:     (a, h) => a.list<Account>('accounts', h),
  listSavedViews:   (a, h) => a.list<SavedView>('savedViews', h),
};
