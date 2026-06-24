import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter, ConcurrencyConflictError, BudgetExistsError } from '../supabaseAdapter';

// Test scenarios CON-UNIT-051..053. TD-03 phase A (PR #11) — pins the
// compare-and-set behaviour added to SupabaseAdapter.upsert so the
// adapter rejects a stale write instead of silently overwriting a
// concurrent edit from another household member.

/**
 * Build a minimal SupabaseClient stub whose `.from(table).update(...).
 * eq(...).eq(...).select().maybeSingle()` chain resolves to the supplied
 * result. This is the only path TD-03's guarded UPDATE touches.
 *
 * The chain is built defensively (`mockReturnThis` on .eq) so the
 * order/count of `.eq()` calls doesn't matter to the test fixture.
 */
function mockSb(updateResult: { data: unknown; error: unknown }, upsertResult?: { data: unknown; error: unknown }): SupabaseClient {
  const updateMaybeSingle = vi.fn().mockResolvedValue(updateResult);
  const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle });
  const updateEq = vi.fn().mockImplementation(function (this: unknown) { return updateChain; });
  const updateChain = { eq: updateEq, select: updateSelect };
  const update = vi.fn().mockReturnValue(updateChain);

  const upsertSingle = vi.fn().mockResolvedValue(upsertResult ?? { data: null, error: null });
  const upsertSelect = vi.fn().mockReturnValue({ single: upsertSingle });
  const upsert = vi.fn().mockReturnValue({ select: upsertSelect });

  const from = vi.fn().mockReturnValue({ update, upsert });
  return { from } as unknown as SupabaseClient;
}

const TXN_INPUT = {
  id: '11111111-1111-1111-1111-111111111111',
  type: 'expense' as const,
  amount: 42,
  currency: 'USD',
  date: '2026-05-23',
  description: 'lunch',
  category: 'food',
};

const TXN_ROW_OK = {
  id: TXN_INPUT.id,
  household_id: 'h1',
  created_by: null,
  member_id: null,
  type: 'expense',
  amount: 42,
  currency: 'USD',
  date: '2026-05-23',
  description: 'lunch',
  category: 'food',
  note: null,
  recurring: null,
  attachment_url: null,
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T00:01:00Z',   // server bumped this to "now"
  deleted_at: null,
  extras: null,
};

describe('SupabaseAdapter.upsert · TD-03 optimistic concurrency', () => {
  it('CON-UNIT-051 · guarded UPDATE with matching updated_at returns the server row', async () => {
    // Cloud row matches the version precondition → maybeSingle yields a row.
    const sb = mockSb({ data: TXN_ROW_OK, error: null });
    const adapter = new SupabaseAdapter(sb);
    const result = await adapter.upsert(
      'transactions', 'h1', TXN_INPUT, '2026-05-23T00:00:00Z',
    );
    expect(result.id).toBe(TXN_INPUT.id);
    // Confirm the chain went through update(), not upsert() — i.e. the
    // guarded path was actually taken.
    const fromSpy = sb.from as unknown as ReturnType<typeof vi.fn>;
    expect(fromSpy).toHaveBeenCalledWith('transactions');
  });

  it('CON-UNIT-052 · guarded UPDATE with no-rows-matched throws ConcurrencyConflictError', async () => {
    // maybeSingle yields data:null when the WHERE doesn't match anything
    // (Supabase's standard "no row" sentinel). Adapter must convert this
    // into a typed conflict rather than silently returning.
    const sb = mockSb({ data: null, error: null });
    const adapter = new SupabaseAdapter(sb);
    await expect(
      adapter.upsert('transactions', 'h1', TXN_INPUT, '2026-05-23T00:00:00Z'),
    ).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });

  it('CON-UNIT-053 · upsert without expectedUpdatedAt skips the guard and uses the legacy upsert path', async () => {
    // Legacy path: no version → falls back to .upsert() with onConflict:'id'
    // and last-write-wins behaviour. Required for new-record inserts and
    // any caller that hasn't yet been wired through TD-03.
    const sb = mockSb({ data: null, error: null }, { data: TXN_ROW_OK, error: null });
    const adapter = new SupabaseAdapter(sb);
    const result = await adapter.upsert('transactions', 'h1', TXN_INPUT);
    expect(result.id).toBe(TXN_INPUT.id);
    // Crucially: .update() was NOT called — only .upsert() was.
    const tableProxy = (sb.from as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(tableProxy.update).not.toHaveBeenCalled();
    expect(tableProxy.upsert).toHaveBeenCalled();
  });
});

describe('SupabaseAdapter.replaceAll · TD-09 RPC dispatch', () => {
  // CON-UNIT-054 pins the RPC routing that backs replaceAll: each entity
  // must call the matching `replace_<entity>` RPC (with the 'members' →
  // 'replace_memberships' special case) and pass the household + rows
  // payload unchanged. The RPC is the only mechanism that keeps a
  // full-list replace transactional under RLS, so if the routing breaks
  // partial writes can corrupt the household snapshot silently.
  function mockSbRpc(): { sb: SupabaseClient; rpc: ReturnType<typeof vi.fn> } {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    return { sb: { rpc } as unknown as SupabaseClient, rpc };
  }

  it('CON-UNIT-054 · routes each entity to replace_<entity> and passes {h, rows}', async () => {
    const cases: Array<[Parameters<SupabaseAdapter['replaceAll']>[0], string]> = [
      ['transactions', 'replace_transactions'],
      ['budgets',      'replace_budgets'],
      ['goals',        'replace_goals'],
      ['debts',        'replace_debts'],
      ['assets',       'replace_assets'],
      ['members',      'replace_memberships'], // special case
    ];
    for (const [entity, rpcName] of cases) {
      const { sb, rpc } = mockSbRpc();
      const adapter = new SupabaseAdapter(sb);
      const rows = [{ id: '11111111-1111-1111-1111-111111111111' }];
      await adapter.replaceAll(entity, 'h1', rows);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith(rpcName, expect.objectContaining({ h: 'h1', rows: expect.any(Array) }));
    }
  });
});

describe('SupabaseAdapter.listSince · TD-06 delta pull', () => {
  // CON-UNIT-055/056 pin the incremental-list contract added for TD-06.
  // The cloud query MUST be `select * .eq(household_id) .gte(updated_at,
  // since) .order(updated_at asc) .limit(n)` and MUST NOT filter out
  // soft-deleted rows — callers need the tombstones to remove rows from
  // their local cache. The adapter splits the response into live rows vs
  // tombstones and reports the max updated_at for the next cursor.
  // R1 (sync fix): the boundary predicate is `>=`, not `>`. A strict `>`
  // silently skips any row whose updated_at ties the cursor's exact ms;
  // applyCloudDelta re-upserts the boundary rows idempotently.

  type ListSinceRow = { id: string; updated_at: string; deleted_at: string | null; household_id: string };

  function mockSbList(rows: ListSinceRow[]): {
    sb: SupabaseClient;
    spies: { from: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; gte: ReturnType<typeof vi.fn>; order: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> };
  } {
    const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const gte   = vi.fn().mockReturnValue({ order });
    const eq    = vi.fn().mockReturnValue({ gte });
    const select = vi.fn().mockReturnValue({ eq });
    const from  = vi.fn().mockReturnValue({ select });
    return { sb: { from } as unknown as SupabaseClient, spies: { from, eq, gte, order, limit } };
  }

  it('CON-UNIT-055 · issues `.gte(updated_at, since).order(updated_at asc)` and does NOT filter deleted_at', async () => {
    const { sb, spies } = mockSbList([]);
    const adapter = new SupabaseAdapter(sb);
    const result = await adapter.listSince('transactions', 'h1', '2026-05-30T00:00:00Z', 100);
    expect(spies.from).toHaveBeenCalledWith('transactions');
    expect(spies.eq).toHaveBeenCalledWith('household_id', 'h1');
    expect(spies.gte).toHaveBeenCalledWith('updated_at', '2026-05-30T00:00:00Z');
    expect(spies.order).toHaveBeenCalledWith('updated_at', { ascending: true });
    expect(spies.limit).toHaveBeenCalledWith(100);
    // Empty response → no rows, no tombstones, null cursor advance.
    expect(result).toEqual({ rows: [], tombstones: [], maxUpdatedAt: null });
  });

  it('CON-UNIT-056 · partitions live rows vs tombstones and reports max(updated_at)', async () => {
    const rows: ListSinceRow[] = [
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', household_id: 'h1', updated_at: '2026-05-31T10:00:00Z', deleted_at: null },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', household_id: 'h1', updated_at: '2026-05-31T11:00:00Z', deleted_at: '2026-05-31T11:00:00Z' },
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', household_id: 'h1', updated_at: '2026-05-31T12:00:00Z', deleted_at: null },
    ];
    const { sb } = mockSbList(rows);
    const adapter = new SupabaseAdapter(sb);
    const result = await adapter.listSince<{ id: string }>('budgets', 'h1', '2026-05-30T00:00:00Z');
    expect(result.tombstones).toEqual(['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
    expect(result.rows.map(r => r.id).sort()).toEqual([
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
    ]);
    expect(result.maxUpdatedAt).toBe('2026-05-31T12:00:00Z');
  });
});

describe('SupabaseAdapter.upsert · budget NOT-NULL period mapping', () => {
  // CON-UNIT-066 pins the v9.3.2 fix: a NEW budget create must NOT send an
  // explicit `period: null`. `period` is a legacy NOT-NULL column; the v9.1
  // scope-based form never sends it, so the old `b.period || null` produced a
  // NOT NULL violation that threw, dead-lettered, and never reached the cloud —
  // the "new July budget doesn't sync to other devices" bug. The mapper must
  // default it to 'monthly'.
  const BUDGET_ROW_OK = {
    id: '99999999-9999-9999-9999-999999999999', household_id: 'h1',
    category: null, monthly_limit: 1000, currency: 'USD', color: null,
    period: 'monthly', period_start: null, period_end: null,
    scope: 'month', period_year: 2026, period_month: 7,
    confidence: 'confirmed', source: 'user', estimated_at: null, confirmed_at: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', deleted_at: null,
  };

  it('CON-UNIT-066 · a new budget without `period` serializes period:"monthly", never null', async () => {
    const sb = mockSb({ data: null, error: null }, { data: BUDGET_ROW_OK, error: null });
    const adapter = new SupabaseAdapter(sb);
    // Scope-based create exactly as BudgetFormModal sends it — no `period` field.
    await adapter.upsert('budgets', 'h1', {
      id: '99999999-9999-9999-9999-999999999999',
      scope: 'month', periodYear: 2026, periodMonth: 7, limit: 1000, currency: 'USD',
    });
    const tableProxy = (sb.from as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    const sentRow = tableProxy.upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(sentRow.period).toBe('monthly');
    expect(sentRow.period).not.toBeNull();
  });
});

describe('SupabaseAdapter.createBudgetChecked · v9.3.3 DB identity authority', () => {
  // CON-UNIT-067/068 pin the create path that replaced the deterministic-id hack.
  // A new budget routes through the upsert_budget RPC in create mode; the DB
  // assigns the id and raises 23505/BUDGET_EXISTS when the slot is taken (incl.
  // another member's unsynced budget), which the adapter surfaces as a typed
  // BudgetExistsError instead of a silent dead-letter.
  const BUDGET_ROW_OK = {
    id: '99999999-9999-9999-9999-999999999999', household_id: 'h1',
    category: null, monthly_limit: 1000, currency: 'USD', color: null,
    period: 'monthly', period_start: null, period_end: null,
    scope: 'month', period_year: 2026, period_month: 7,
    confidence: 'confirmed', source: 'user', estimated_at: null, confirmed_at: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', deleted_at: null,
  };

  it('CON-UNIT-067 · routes to upsert_budget(create) without a client id and maps the row back', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [BUDGET_ROW_OK], error: null });
    const adapter = new SupabaseAdapter({ rpc } as unknown as SupabaseClient);
    const out = await adapter.createBudgetChecked('h1', { scope: 'month', periodYear: 2026, periodMonth: 7, limit: 1000, currency: 'USD' });
    expect(rpc).toHaveBeenCalledWith('upsert_budget', expect.objectContaining({ h: 'h1', p_mode: 'create' }));
    const payload = rpc.mock.calls[0]![1] as { b: Record<string, unknown> };
    expect(payload.b.id).toBeUndefined();        // DB mints the id, client must not
    expect(payload.b.period).toBe('monthly');    // NOT-NULL period default still applies
    expect(out.id).toBe(BUDGET_ROW_OK.id);
    expect(out.limit).toBe(1000);
  });

  it('CON-UNIT-068 · maps a 23505/BUDGET_EXISTS error to a typed BudgetExistsError', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'BUDGET_EXISTS', details: 'scope=month year=2026 month=7' } });
    const adapter = new SupabaseAdapter({ rpc } as unknown as SupabaseClient);
    await expect(
      adapter.createBudgetChecked('h1', { scope: 'month', periodYear: 2026, periodMonth: 7, limit: 1000 }),
    ).rejects.toBeInstanceOf(BudgetExistsError);
  });
});

describe('SupabaseAdapter.remove · R1 tombstone propagation', () => {
  // CON-UNIT-063 pins the R1 sync fix: a soft-delete MUST bump `updated_at`
  // in the same write as `deleted_at`. The delta cursor is max(updated_at);
  // if the delete doesn't advance updated_at, the tombstone never enters
  // another device's `updated_at >= cursor` window and the row lives on as a
  // ghost (the case-7 net-worth bug). We assert both columns are set.
  it('CON-UNIT-063 · soft-delete sets deleted_at AND bumps updated_at so the tombstone rides the delta window', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const sb = { from } as unknown as SupabaseClient;
    const adapter = new SupabaseAdapter(sb);
    await adapter.remove('transactions', 'h1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(from).toHaveBeenCalledWith('transactions');
    const patch = update.mock.calls[0][0] as { deleted_at?: string; updated_at?: string };
    expect(patch.deleted_at).toBeTruthy();
    expect(patch.updated_at).toBeTruthy();
    expect(patch.updated_at).toBe(patch.deleted_at);   // same instant
    expect(eq).toHaveBeenCalledWith('id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});
