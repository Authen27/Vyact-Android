import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter, WriteNotAppliedError } from '../supabaseAdapter';
import type { PayLoanCommand } from '../../types';
import { LoanPaymentRefused } from '../loanSchedule';

// CON-UNIT-113..116 — the loan-payment command at the adapter boundary (W4f: pay_loan, where the
// SERVER computes the split; audit F2's record_loan_payment, which took a client-computed split, is
// retired), plus the updateProfile write-check (audit F7).
//
// The RPC is the durability boundary: it validates caller role and tenancy, computes the split and
// applies every write in one transaction. These pin the CLIENT side of that contract: exact parameter
// mapping, refusals surfacing with pay_loan's own code and figure (never a silent success), and
// adopting what the server returned.

function mockRpcClient(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { sb: { rpc } as unknown as SupabaseClient, rpc };
}

const CMD: PayLoanCommand = {
  operationId: 'op-1', debtId: 'debt-1', kind: 'emi', amount: 1170, date: '2026-09-08',
  fundingAccountId: 'acc-1', memberId: 'mem-1', description: 'Mortgage EMI',
};

const returned = {
  status: 'success', operation_id: 'op-1', kind: 'emi', interest: 170.5, principal: 999.5, instalment_no: 13,
  closes_instalment: true, paid_off: false, outstanding_after: 199000.5, next_due_date: '2026-10-08', emi_after: 1170,
  debt: { id: 'debt-1', type: 'home_loan', name: 'Mortgage', currency: 'GBP', current_balance: 199000.5, principal: 200000,
    interest_rate: 1, minimum_payment: 1170, instalments_paid: 13, due_date: '2026-10-08' },
  loan_account: { id: 'la1', kind: 'loan', name: 'Mortgage', currency: 'GBP', debt_id: 'debt-1',
    opening_balance: -200000, reconciliation_offset: 25, reconciliation_log: [] },
  transactions: [],
};

describe('SupabaseAdapter.payLoan (W4f)', () => {
  it('CON-UNIT-113 · maps the command to pay_loan exactly, and reads its result', async () => {
    const { sb, rpc } = mockRpcClient({ data: returned });
    const res = await new SupabaseAdapter(sb).payLoan('h1', CMD);
    expect(rpc).toHaveBeenCalledWith('pay_loan', {
      p_operation_id: 'op-1', p_debt_id: 'debt-1', p_kind: 'emi', p_amount: 1170, p_date: '2026-09-08',
      p_funding_account_id: 'acc-1', p_member_id: 'mem-1', p_description: 'Mortgage EMI',
      p_prepayment_choice: null, p_bank_interest: null, p_bank_principal: null,
    });
    expect(res).toMatchObject({ status: 'success', interest: 170.5, principal: 999.5, instalmentNo: 13, closesInstalment: true,
      outstandingAfter: 199000.5, nextDueDate: '2026-10-08', debt: { currentBalance: 199000.5, instalmentsPaid: 13 },
      loanAccount: { openingBalance: -200000, reconciliationOffset: 25 } });
    // A prepayment says which way; bank figures carry the bank's split.
    await new SupabaseAdapter(sb).payLoan('h1', { ...CMD, kind: 'prepayment', choice: 'reduce_emi' });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_kind: 'prepayment', p_prepayment_choice: 'reduce_emi', p_bank_interest: null });
    await new SupabaseAdapter(sb).payLoan('h1', { ...CMD, kind: 'bank_override', bankInterest: 170, bankPrincipal: 1000 });
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_kind: 'bank_override', p_prepayment_choice: null, p_bank_interest: 170, p_bank_principal: 1000 });
  });

  it('CON-UNIT-114 · a refusal THROWS with pay_loan’s code and the figure it names — never a silent success', async () => {
    const { sb } = mockRpcClient({ data: null, error: { message: 'more_than_due', details: '8884.88', code: '22023' } });
    const err = await new SupabaseAdapter(sb).payLoan('h1', CMD).catch(e => e);
    expect(err).toBeInstanceOf(LoanPaymentRefused);
    expect(err).toMatchObject({ code: 'more_than_due', figure: 8884.88 });
  });

  it('CON-UNIT-115 · an idempotent retry returns the original payment', async () => {
    const { sb } = mockRpcClient({ data: { ...returned, status: 'duplicate' } });
    const res = await new SupabaseAdapter(sb).payLoan('h1', CMD);
    expect(res.status).toBe('duplicate');
    expect(res.operationId).toBe('op-1');
  });

  it('CON-UNIT-116 · a transport error propagates (the caller toasts the failure)', async () => {
    const { sb } = mockRpcClient({ data: null, error: new Error('network') });
    await expect(new SupabaseAdapter(sb).payLoan('h1', CMD)).rejects.toThrow('network');
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
