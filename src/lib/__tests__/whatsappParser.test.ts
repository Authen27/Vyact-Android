// Vyact — deterministic WhatsApp parser tests.
// The parser lives in the Deno edge tree (self-contained, no Deno globals), so it
// imports cleanly here for unit coverage. Mirrors the MVP command-grammar contract.
import { describe, it, expect } from 'vitest';
import {
  parseWhatsAppMessage,
  isQueryAttempt,
  parseAmount,
  matchCategory,
  EXPENSE_IDS,
  INCOME_IDS,
  type AccountLite,
} from '../../../../supabase/functions/_shared/whatsapp-parser';

const ACCOUNTS: AccountLite[] = [
  { name: 'HDFC', kind: 'bank' },
  { name: 'ICICI', kind: 'bank' },
  { name: 'Amex', kind: 'credit_card' },
  { name: 'Vanguard', kind: 'investment' },
];

describe('parseAmount shorthands', () => {
  it('handles k / lakh / cr / commas', () => {
    expect(parseAmount('10k')).toBe(10000);
    expect(parseAmount('2.5k')).toBe(2500);
    expect(parseAmount('3 lakh')).toBe(300000);
    expect(parseAmount('1,200')).toBe(1200);
    expect(parseAmount('850')).toBe(850);
    expect(parseAmount('no number here')).toBeUndefined();
  });
});

describe('command grammar → expense', () => {
  it('amount + category + account', () => {
    const r = parseWhatsAppMessage('850 groceries hdfc', ACCOUNTS, 'INR');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tx.amount).toBe(850);
    expect(r.tx.transaction_type).toBe('expense');
    expect(r.tx.category_id).toBe('groceries');
    expect(r.tx.account_alias).toBe('HDFC');
    expect(r.tx.to_account_alias).toBeNull();
  });

  it('filler words are ignored', () => {
    const r = parseWhatsAppMessage('spent 850 on groceries from hdfc', ACCOUNTS, 'INR');
    expect(r.ok && r.tx.category_id).toBe('groceries');
    expect(r.ok && r.tx.account_alias).toBe('HDFC');
  });

  it('unknown category → other_expense, unknown account → cash', () => {
    const r = parseWhatsAppMessage('420 widgets', ACCOUNTS);
    expect(r.ok && r.tx.category_id).toBe('other_expense');
    expect(r.ok && r.tx.account_alias).toBe('cash');
  });
});

describe('income detection', () => {
  it('+ prefix → income', () => {
    const r = parseWhatsAppMessage('+50000 salary', ACCOUNTS, 'INR');
    expect(r.ok && r.tx.transaction_type).toBe('income');
    expect(r.ok && r.tx.category_id).toBe('salary');
  });
  it('income keyword → income', () => {
    const r = parseWhatsAppMessage('received 1200 freelance', ACCOUNTS);
    expect(r.ok && r.tx.transaction_type).toBe('income');
    expect(r.ok && r.tx.category_id).toBe('freelance');
  });
});

describe('transfer detection', () => {
  it('moved X to <account> → transfer with source+dest, null category', () => {
    const r = parseWhatsAppMessage('moved 10000 to icici', ACCOUNTS, 'INR');
    expect(r.ok && r.tx.transaction_type).toBe('transfer');
    expect(r.ok && r.tx.category_id).toBeNull();
    expect(r.ok && r.tx.to_account_alias).toBe('ICICI');
  });
});

describe('investment detection', () => {
  it('invested keyword → investment, null category', () => {
    const r = parseWhatsAppMessage('invested 5000 in vanguard', ACCOUNTS);
    expect(r.ok && r.tx.transaction_type).toBe('investment');
    expect(r.ok && r.tx.category_id).toBeNull();
    expect(r.ok && r.tx.to_account_alias).toBe('Vanguard');
  });
});

describe('currency detection', () => {
  it('₹ / symbols override base', () => {
    expect((parseWhatsAppMessage('₹850 lunch', ACCOUNTS, 'USD') as any).tx.currency).toBe('INR');
    expect((parseWhatsAppMessage('$20 coffee', ACCOUNTS, 'INR') as any).tx.currency).toBe('USD');
    expect((parseWhatsAppMessage('20 coffee', ACCOUNTS, 'INR') as any).tx.currency).toBe('INR');
  });
});

describe('hard-block queries', () => {
  it('flags read requests, not logging lines', () => {
    expect(isQueryAttempt("what's my balance")).toBe(true);
    expect(isQueryAttempt('how much did i spend')).toBe(true);
    expect(isQueryAttempt('net worth')).toBe(true);
    expect(isQueryAttempt('850 groceries hdfc')).toBe(false);
  });
  it('query line → not ok, reason query', () => {
    const r = parseWhatsAppMessage("what's my net worth?", ACCOUNTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('query');
  });
  it('empty / no-amount lines clarify', () => {
    expect((parseWhatsAppMessage('', ACCOUNTS) as any).reason).toBe('empty');
    expect((parseWhatsAppMessage('groceries please', ACCOUNTS) as any).reason).toBe('no_amount');
  });
});

describe('category id sets stay valid', () => {
  it('matchCategory only yields ids in the valid sets', () => {
    const cat = matchCategory('netflix subscription');
    expect(cat && (EXPENSE_IDS.has(cat) || INCOME_IDS.has(cat))).toBe(true);
  });
});

// v10.25.0 (R3) — the payment mode a message names.
import { detectPaymentMode, PAYMENT_MODE_IDS, PAYMENT_MODE_LABEL as WA_MODE_LABEL } from '../../../../supabase/functions/_shared/whatsapp-parser';
import { PAYMENT_MODE_IDS as AGENT_MODE_IDS } from '../../../../supabase/functions/_shared/agent/types';
import { PAYMENT_MODE_LABEL } from '../accountsView';

describe('payment mode from a WhatsApp line', () => {
  it.each([
    ['450 lunch hdfc gpay', 'upi'],
    ['1200 groceries paytm', 'upi'],
    ['2000 shopping amex upi on card', 'upi_on_card'],
    ['900 fuel hdfc debit card', 'debit_card'],
    ['15000 rent neft hdfc', 'net_banking'],
    ['5000 school fees cheque', 'cheque'],
    ['799 netflix amex online', 'online'],
    ['3200 dinner amex swiped', 'swipe'],
    ['650 insurance auto debit', 'auto_debit'],
  ])('%s → %s', (line, mode) => {
    const r = parseWhatsAppMessage(line, ACCOUNTS, 'INR');
    expect(r.ok && r.tx.payment_mode).toBe(mode);
  });

  it('a line that names no mode carries none — nothing is guessed', () => {
    const r = parseWhatsAppMessage('850 groceries hdfc', ACCOUNTS, 'INR');
    expect(r.ok && r.tx.payment_mode).toBeNull();
  });

  it('an investment never carries a mode, even when one is named', () => {
    const r = parseWhatsAppMessage('invested 5000 via upi to vanguard', ACCOUNTS, 'INR');
    expect(r.ok && r.tx.transaction_type).toBe('investment');
    expect(r.ok && r.tx.payment_mode).toBeNull();
  });

  it('every detected mode is in the allowlist', () => {
    for (const line of ['gpay', 'neft', 'cheque', 'online', 'swipe', 'debit card', 'upi on card', 'auto debit', 'standing instruction']) {
      const mode = detectPaymentMode(line);
      expect(mode && PAYMENT_MODE_IDS.has(mode)).toBe(true);
    }
  });
});

describe('payment mode sets — the client, WhatsApp and agent copies must not drift', () => {
  const client = Object.keys(PAYMENT_MODE_LABEL).sort();
  it('the WhatsApp parser accepts exactly the modes the app offers, with the same labels', () => {
    expect([...PAYMENT_MODE_IDS].sort()).toEqual(client);
    expect(WA_MODE_LABEL).toEqual(PAYMENT_MODE_LABEL);
  });
  it('the agent accepts exactly the modes the app offers', () => {
    expect([...AGENT_MODE_IDS].sort()).toEqual(client);
  });
});
