import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter } from '../supabaseAdapter';
import type { Account } from '../../types';

// CON-UNIT-081..083 — Phase 0.5. The account-patch data-loss fix (audit F1).
//
// THE BUG THESE PIN:
//   AccountFormModal sends a metadata-only patch — name, kind, currency, flags.
//   `accountToRow` then read `a.openingBalance ?? 0`, `a.reconciliationOffset ?? 0`
//   and `a.reconciliationLog ?? []`. On an UPSERT that is not a default, it is an
//   erasure: renaming or archiving an account wrote 0 over its opening balance
//   and emptied its reconciliation history, under an "Account updated" toast.
//
// All three columns are NOT NULL *with a DB default* (0, 0, '[]'::jsonb), so
// omitting them is correct in both directions — Postgres supplies the default on
// INSERT, and on ON CONFLICT UPDATE an absent column is not in the SET list, so
// the stored value survives.
//
// These assert on the PAYLOAD rather than a round trip, because the failure was
// a payload-shape bug: the write "succeeded" every time.

/** Capture what the adapter hands to PostgREST for an accounts upsert. */
function captureUpsert() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: 'a1', household_id: 'h1', kind: 'bank', name: 'Renamed',
      currency: 'GBP', is_default: false, is_archived: false,
      opening_balance: 500, reconciliation_offset: 25, reconciliation_log: [],
    },
    error: null,
  });
  const select = vi.fn().mockReturnValue({ single });
  const upsert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ upsert });
  return { sb: { from } as unknown as SupabaseClient, upsert };
}

describe('account patches must not erase financial state (audit F1)', () => {
  it('CON-UNIT-081 · a metadata-only patch omits the financial columns entirely', async () => {
    const { sb, upsert } = captureUpsert();
    // Exactly what AccountFormModal builds: no openingBalance, no
    // reconciliationOffset, no reconciliationLog.
    await new SupabaseAdapter(sb).upsert('accounts', 'h1', {
      id: 'a1', kind: 'bank', name: 'Renamed', currency: 'GBP',
      isDefault: false, isArchived: false,
    });

    const row = upsert.mock.calls[0][0] as Record<string, unknown>;

    // The whole fix: absent from the payload, so the column keeps its value.
    expect(row, 'opening_balance must not be sent').not.toHaveProperty('opening_balance');
    expect(row, 'reconciliation_offset must not be sent').not.toHaveProperty('reconciliation_offset');
    expect(row, 'reconciliation_log must not be sent').not.toHaveProperty('reconciliation_log');

    // Belt and braces: the old code sent literal zeroes. Assert that shape is
    // gone, not merely that the keys are absent — a future refactor that
    // reintroduces `?? 0` would fail here loudly.
    expect(row.opening_balance).toBeUndefined();
    expect(row.reconciliation_offset).toBeUndefined();

    // The metadata the caller DID send must still be written.
    expect(row.name).toBe('Renamed');
    expect(row.currency).toBe('GBP');
  });

  it('CON-UNIT-082 · financial values are written when the caller supplies them', async () => {
    // The guard must not swing the other way: reconcile sends `{...account,
    // ...patch}` and those values have to reach the database.
    const { sb, upsert } = captureUpsert();
    await new SupabaseAdapter(sb).upsert('accounts', 'h1', {
      id: 'a1', kind: 'bank', name: 'Current', currency: 'GBP',
      openingBalance: 500,
      reconciliationOffset: 25,
      reconciliationLog: [{ at: '2026-01-01T00:00:00Z', delta: 25, kind: 'bank', stated_value: 525 }],
    });

    const row = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.opening_balance).toBe(500);
    expect(row.reconciliation_offset).toBe(25);
    expect(row.reconciliation_log).toHaveLength(1);
  });

  it('CON-UNIT-083 · an explicit zero is still an explicit zero', async () => {
    // `?? 0` and `!== undefined` differ exactly here. A user setting an opening
    // balance to 0 on purpose must be written, not treated as "unspecified" —
    // otherwise the fix would introduce the mirror-image bug where a balance
    // can never be cleared.
    const { sb, upsert } = captureUpsert();
    await new SupabaseAdapter(sb).upsert('accounts', 'h1', {
      id: 'a1', kind: 'bank', name: 'Zeroed', currency: 'GBP',
      openingBalance: 0,
      reconciliationOffset: 0,
      reconciliationLog: [],
    });

    const row = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toHaveProperty('opening_balance', 0);
    expect(row).toHaveProperty('reconciliation_offset', 0);
    expect(row).toHaveProperty('reconciliation_log');
    expect(row.reconciliation_log).toEqual([]);
  });

  it('CON-UNIT-083b · debtId is written when supplied and omitted from metadata patches (audit F2 link)', async () => {
    const { sb, upsert } = captureUpsert();
    // A loan account created by the payment command carries the explicit link.
    await new SupabaseAdapter(sb).upsert('accounts', 'h1', {
      id: 'a1', kind: 'loan', name: 'Car Loan', currency: 'USD', debtId: 'd-1',
    });
    let row = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.debt_id).toBe('d-1');

    // …and a metadata-only patch must NOT erase it (same F1 rule).
    const { sb: sb2, upsert: upsert2 } = captureUpsert();
    await new SupabaseAdapter(sb2).upsert('accounts', 'h1', {
      id: 'a1', kind: 'loan', name: 'Renamed Loan', currency: 'USD',
    });
    row = upsert2.mock.calls[0][0] as Record<string, unknown>;
    expect(row, 'debt_id must not be sent on a metadata patch').not.toHaveProperty('debt_id');
  });

  it('CON-UNIT-083c · a row re-saved with a spread never names an R2 column the database did not return', async () => {
    // Lane B (PR #95): reconcile re-saves `{...account, ...patch}`. The read
    // mapper defaulted absent card columns to null / [], so the re-save sent
    // billing_cycle_day to a schema without it and PostgREST refused (PGRST204).
    // Production has the same window between a Vercel deploy and `db push`.
    const R2 = ['payment_modes', 'credit_limit', 'billing_cycle_day', 'payment_due_day', 'last_reconciled_at'];
    const { sb, upsert } = captureUpsert();   // its returned row predates R2
    const adapter = new SupabaseAdapter(sb);
    const read = await adapter.upsert<Partial<Account>>('accounts', 'h1', { id: 'a1', kind: 'bank', name: 'Renamed', currency: 'GBP' });
    await adapter.upsert('accounts', 'h1', { ...read, reconciliationOffset: 30 });
    const row = upsert.mock.calls[1][0] as Record<string, unknown>;
    for (const col of R2) expect(row, `${col} must not be sent`).not.toHaveProperty(col);
    expect(row.reconciliation_offset).toBe(30);
  });

  it('CON-UNIT-083d · on a migrated schema the same re-save keeps every R2 value, nulls included', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'a2', household_id: 'h1', kind: 'credit_card', name: 'Regalia', currency: 'INR',
        is_default: false, is_archived: false, opening_balance: -18400, reconciliation_offset: 0, reconciliation_log: [],
        payment_modes: ['swipe', 'online'], credit_limit: '150000.00', billing_cycle_day: 11,
        payment_due_day: null, last_reconciled_at: null,
      },
      error: null,
    });
    const upsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    const adapter = new SupabaseAdapter({ from: vi.fn().mockReturnValue({ upsert }) } as unknown as SupabaseClient);
    const read = await adapter.upsert<Partial<Account>>('accounts', 'h1', { id: 'a2', kind: 'credit_card', name: 'Regalia', currency: 'INR' });
    expect(read.creditLimit).toBe(150000);
    await adapter.upsert('accounts', 'h1', { ...read });
    const row = upsert.mock.calls[1][0] as Record<string, unknown>;
    expect(row.payment_modes).toEqual(['swipe', 'online']);
    expect(row.credit_limit).toBe(150000);
    expect(row.billing_cycle_day).toBe(11);
    expect(row).toHaveProperty('payment_due_day', null);
    expect(row).toHaveProperty('last_reconciled_at', null);
  });
});
