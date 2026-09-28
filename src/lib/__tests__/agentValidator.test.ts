// Vyact Agent — validator + signature tests (architecture §3.2 / §3.4).
//
// These pin the guards that make LLM-first extraction safe. The modules live in
// the Deno edge tree but are pure, so they import cleanly here (same pattern as
// whatsappParser.test.ts). Per the architecture doc, agent EVALS live in a
// separate harness; these are deterministic unit tests and belong in vitest.
import { describe, it, expect } from 'vitest';
import {
  validateExtraction, amountAppearsInSource, amountLooksLikeBalance,
  sourceDirection, numbersInText,
} from '../../../../supabase/functions/_shared/agent/validator';
import { smsSkeleton, smsSignature } from '../../../../supabase/functions/_shared/agent/signature';

// Real-shaped bank SMS. The balance at the end is the trap the whole validator exists for.
const HDFC_UPI =
  'Rs.850.00 debited from A/c XX4471 on 14-08 to VPA swiggy@ybl. Ref 4429911. Avl Bal Rs.12,340.00';
const ICICI_CREDIT =
  'Dear Customer, Acct XX9920 is credited with Rs 25,000.00 on 01-08-25 from SALARY. Avl Bal Rs 61,204.55';
const NOW = new Date('2026-08-20T10:00:00Z');

describe('numbersInText', () => {
  it('finds grouped and decimal numbers', () => {
    expect(numbersInText('Rs.850.00 ... Rs.12,340.00')).toEqual([850, 12340]);
    expect(numbersInText('1,23,456.78')).toEqual([123456.78]);
  });
});

describe('amountAppearsInSource — blocks invented numbers', () => {
  it('accepts an amount that is really there (grouping tolerant)', () => {
    expect(amountAppearsInSource(850, HDFC_UPI)).toBe(true);
    expect(amountAppearsInSource(12340, HDFC_UPI)).toBe(true);
    expect(amountAppearsInSource(25000, ICICI_CREDIT)).toBe(true);
  });
  it('rejects a hallucinated amount', () => {
    expect(amountAppearsInSource(999, HDFC_UPI)).toBe(false);
  });
});

describe('amountLooksLikeBalance — THE classic failure', () => {
  it('flags the available balance', () => {
    expect(amountLooksLikeBalance(12340, HDFC_UPI)).toBe(true);
    expect(amountLooksLikeBalance(61204.55, ICICI_CREDIT)).toBe(true);
  });
  it('does NOT flag the real transaction amount', () => {
    expect(amountLooksLikeBalance(850, HDFC_UPI)).toBe(false);
    expect(amountLooksLikeBalance(25000, ICICI_CREDIT)).toBe(false);
  });
  it('handles credit-limit phrasing too', () => {
    const card = 'Spent Rs.1200 on Card XX1234. Avl Lmt Rs.45000';
    expect(amountLooksLikeBalance(45000, card)).toBe(true);
    expect(amountLooksLikeBalance(1200, card)).toBe(false);
  });
});

describe('sourceDirection — explicit polarity only', () => {
  it('reads debit and credit', () => {
    expect(sourceDirection(HDFC_UPI)).toBe('debit');
    expect(sourceDirection(ICICI_CREDIT)).toBe('credit');
  });
  it('reports both/none rather than guessing', () => {
    expect(sourceDirection('A/c debited and beneficiary credited')).toBe('both');
    expect(sourceDirection('Your statement is ready')).toBe('none');
  });
});

describe('validateExtraction', () => {
  it('passes a correct extraction with no issues', () => {
    const r = validateExtraction(
      { amount: 850, currency: 'INR', direction: 'debit', transaction_type: 'expense',
        accountMask: '4471', date: '2026-08-14' },
      HDFC_UPI, { now: NOW },
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.mustConfirm).toBe(false);
  });

  it('REJECTS the available balance as the amount', () => {
    const r = validateExtraction(
      { amount: 12340, currency: 'INR', direction: 'debit', transaction_type: 'expense' },
      HDFC_UPI, { now: NOW },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('amount_is_balance');
  });

  it('REJECTS an invented amount', () => {
    const r = validateExtraction(
      { amount: 999, direction: 'debit', transaction_type: 'expense' },
      HDFC_UPI, { now: NOW },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('amount_not_in_source');
  });

  it('REJECTS a credit booked as an expense', () => {
    const r = validateExtraction(
      { amount: 25000, direction: 'debit', transaction_type: 'expense' },
      ICICI_CREDIT, { now: NOW },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('polarity_contradicts_type');
  });

  it('REJECTS a future date', () => {
    const r = validateExtraction(
      { amount: 850, direction: 'debit', transaction_type: 'expense', date: '2027-01-01' },
      HDFC_UPI, { now: NOW },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('date_future');
  });

  it('degrades (not rejects) on a stale date and forces confirmation', () => {
    const r = validateExtraction(
      { amount: 850, direction: 'debit', transaction_type: 'expense', date: '2024-01-05' },
      HDFC_UPI, { now: NOW },
    );
    expect(r.ok).toBe(true);
    expect(r.mustConfirm).toBe(true);
    expect(r.confidencePenalty).toBeGreaterThan(0);
    expect(r.issues.map(i => i.code)).toContain('date_too_old');
  });

  it('degrades on an unknown currency and a mask absent from source', () => {
    const r = validateExtraction(
      { amount: 850, currency: 'XYZ', direction: 'debit', transaction_type: 'expense', accountMask: '0000' },
      HDFC_UPI, { now: NOW },
    );
    expect(r.ok).toBe(true);
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain('currency_unknown');
    expect(codes).toContain('mask_not_in_source');
  });

  it('rejects a missing or non-positive amount', () => {
    expect(validateExtraction({}, HDFC_UPI, { now: NOW }).ok).toBe(false);
    expect(validateExtraction({ amount: 0 }, HDFC_UPI, { now: NOW }).ok).toBe(false);
  });

  it('flags conflicting polarity rather than guessing', () => {
    const both = 'A/c XX1 debited Rs.500 and A/c XX2 credited';
    const r = validateExtraction(
      { amount: 500, direction: 'debit', transaction_type: 'expense' }, both, { now: NOW },
    );
    expect(r.issues.map(i => i.code)).toContain('polarity_conflict');
    expect(r.mustConfirm).toBe(true);
  });
});

describe('smsSignature — learned-recipe cache key (§3.2)', () => {
  it('collapses the SAME format with different amount/date/account/merchant', () => {
    const a = 'Rs.850.00 debited from A/c XX4471 on 14-08 to VPA swiggy@ybl. Ref 4429911';
    const b = 'Rs.1,299.50 debited from A/c XX9920 on 02-09 to VPA amazon@apl. Ref 8123344';
    expect(smsSignature(a)).toBe(smsSignature(b));
  });

  it('collapses multi-word merchants to the same signature', () => {
    const a = 'Rs.500 debited from A/c XX1234 on 01-01 to BIG BAZAAR STORE. Ref 111111';
    const b = 'Rs.700 debited from A/c XX5678 on 02-02 to ZOMATO. Ref 222222';
    expect(smsSignature(a)).toBe(smsSignature(b));
  });

  it('DISTINGUISHES genuinely different formats', () => {
    const debit = 'Rs.850.00 debited from A/c XX4471 on 14-08 to VPA swiggy@ybl. Ref 4429911';
    const credit = 'Dear Customer, Acct XX9920 is credited with Rs 25,000.00 on 01-08-25 from SALARY';
    expect(smsSignature(debit)).not.toBe(smsSignature(credit));
  });

  it('is stable and versioned', () => {
    const s = smsSignature(HDFC_UPI);
    expect(s).toBe(smsSignature(HDFC_UPI));
    expect(s.startsWith('v1_')).toBe(true);
  });

  it('skeleton masks values but keeps banking vocabulary', () => {
    const sk = smsSkeleton(HDFC_UPI);
    expect(sk).toContain('debited');
    expect(sk).toContain('a/c');
    expect(sk).toContain('#');
    expect(sk).not.toContain('swiggy');
    expect(sk).not.toContain('850');
  });
});
