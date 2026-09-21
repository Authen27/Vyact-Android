import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter, WriteNotAppliedError } from '../supabaseAdapter';
import type { RecordLoanPaymentCommand } from '../../types';

// CON-UNIT-113..117 — the atomic loan-payment command (audit F2) at the
// adapter boundary, plus the updateProfile write-check (audit F7).
//
// The RPC is the durability boundary: it validates caller role, tenancy and
// split reconciliation and applies every write in one transaction. These pin
// the CLIENT side of that contract: exact parameter mapping, rejection
// surfacing (never a silent "success"), and result-id adoption.

function mockRpcClient(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { sb: { rpc } as unknown as SupabaseClient, rpc };
}

const CMD: RecordLoanPaymentCommand = {
  operationId: 'op-1',
  debtId: 'debt-1',
  fundingAccountId: 'acc-1',
  amount: 1170,
  currency: 'GBP',
  date: '2026-09-08',
  interest: 170.5,
  principal: 999.5,
  memberId: 'mem-1',
  description: 'Mortgage EMI',
  newBalance: 199000.5,
  newRemainingMonths: 287,
  newMinimumPayment: 1170,
  paymentLogEntry: { id: 'log-1', date: '2026-09-08', amount: 1170, interest: 170.5, principal: 999.5, outstandingAfter: 199000.5, isPartPayment: false },
};

const returnedRows = {
  debt: { id: 'debt-1', type: 'loan', name: 'Mortgage', currency: 'GBP', current_balance: 199000.5,
    principal: 200000, interest_rate: 1, minimum_payment: 1170, extras: { remainingMonths: 287 } },
  loan_account: { id: 'la1', kind: 'loan', name: 'Mortgage', currency: 'GBP', debt_id: 'debt-1',
    opening_balance: -200000, reconciliation_offset: 25, reconciliation_log: [] },
  transactions: [],
};

describe('SupabaseAdapter.recordLoanPayment (audit F2)', () => {
  it('CON-UNIT-113 · maps the command to the RPC contract exactly', async () => {
    const { sb, rpc } = mockRpcClient({
      data: { ...returnedRows, status: 'success', expense_txn_id: 'e1', transfer_txn_id: 't1', loan_account_id: 'la1' },
    });
    const res = await new SupabaseAdapter(sb).recordLoanPayment('h1', CMD);

    expect(rpc).toHaveBeenCalledWith('record_loan_payment', {
      p_operation_id: 'op-1',
      p_debt_id: 'debt-1',
      p_funding_account_id: 'acc-1',
      p_amount: 1170,
      p_currency: 'GBP',
      p_date: '2026-09-08',
      p_interest: 170.5,
      p_principal: 999.5,
      p_member_id: 'mem-1',
      p_description: 'Mortgage EMI',
      p_new_balance: 199000.5,
      p_new_remaining_months: 287,
      p_new_minimum_payment: 1170,
      p_payment_log_entry: CMD.paymentLogEntry,
    });
    expect(res).toMatchObject({ status: 'success', expenseTxnId: 'e1', transferTxnId: 't1', loanAccountId: 'la1',
      debt: { currentBalance: 199000.5 }, loanAccount: { openingBalance: -200000, reconciliationOffset: 25 } });
  });

  it('CON-UNIT-114 · a server-side rejection (bad split, tenancy, role) THROWS — never a silent success', async () => {
    const { sb } = mockRpcClient({ data: { status: 'error', reason: 'split_mismatch' } });
    await expect(new SupabaseAdapter(sb).recordLoanPayment('h1', CMD))
      .rejects.toThrow(/split_mismatch/);
  });

  it('CON-UNIT-115 · an idempotent retry returns duplicate with the ORIGINAL ids', async () => {
    const { sb } = mockRpcClient({
      data: { ...returnedRows, status: 'duplicate', expense_txn_id: 'e0', transfer_txn_id: 't0', loan_account_id: 'la0' },
    });
    const res = await new SupabaseAdapter(sb).recordLoanPayment('h1', CMD);
    expect(res.status).toBe('duplicate');
    expect(res.expenseTxnId).toBe('e0');
  });

  it('CON-UNIT-116 · a transport error propagates (the caller toasts the failure)', async () => {
    const { sb } = mockRpcClient({ data: null, error: new Error('network') });
    await expect(new SupabaseAdapter(sb).recordLoanPayment('h1', CMD)).rejects.toThrow('network');
  });
});

describe('SupabaseAdapter.updateProfile — a refused write must not report success (audit F7)', () => {
  function profileSb(updateResult: { data: unknown; error: unknown }) {
    const select = vi.fn().mockResolvedValue(updateResult);
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } });
    return { from, auth: { getUser } } as unknown as SupabaseClient;
  }

  it('CON-UNIT-117 · an unresolved PostgREST { error } now throws (it used to be ignored)', async () => {
    const sb = profileSb({ data: null, error: new Error('column does not exist') });
    await expect(new SupabaseAdapter(sb).updateProfile('h1', { name: 'X' })).rejects.toThrow('column does not exist');
  });

  it('CON-UNIT-117b · a zero-row UPDATE (RLS-refused) throws WriteNotAppliedError', async () => {
    const sb = profileSb({ data: [], error: null });
    await expect(new SupabaseAdapter(sb).updateProfile('h1', { name: 'X' }))
      .rejects.toBeInstanceOf(WriteNotAppliedError);
  });
});
