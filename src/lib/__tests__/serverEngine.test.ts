// W4 (v10.45.0) — the app's Ask Vyact engine, run on the server.
//
// The server runs a BUNDLE of this same code (supabase/functions/_shared/agent/
// engine.generated.js). These tests pin: (1) the context built from database rows is
// the one the app builds from the same data; (2) the bundle and the source give the
// same turn for the same question — parity by construction, checked; (3) the
// WhatsApp rendering.
import { describe, expect, it } from 'vitest';
import { contextFromRows, answerOnServer, renderForWhatsApp, WHATSAPP_MAX_CHARS, type HouseholdRows } from '../serverEngine';
import { mapCloudRow, profileFromRows } from '../supabaseAdapter';
import { buildSafeSummary } from '../aiSummary';
import { DEFAULT_RATES } from '../../constants';
import type { ModelCall } from '../askVyactLlm';
import type { Transaction, Account } from '../../types';
import * as bundle from '../../../../supabase/functions/_shared/agent/engine.generated.js';

const HID = '11111111-1111-4111-8111-111111111111';
const ACC = '22222222-2222-4222-8222-222222222222';
const month = new Date().toISOString().slice(0, 7);
const txn = (id: string, p: Record<string, unknown>) => ({
  id, household_id: HID, created_by: null, member_id: null, currency: 'INR', date: `${month}-02`, description: 'x',
  note: null, recurring: null, extras: {}, account_id: null, to_account_id: null, initiated_by: null,
  recurring_schedule_id: null, debt_id: null, payment_mode: null, asset_id: null, category: null,
  created_at: `${month}-02T10:00:00Z`, updated_at: `${month}-02T10:00:00Z`, deleted_at: null, ...p,
});
function rows(p: Partial<HouseholdRows> = {}): HouseholdRows {
  return {
    transactions: [
      txn('t-1', { type: 'income', amount: 90000, category: 'salary', to_account_id: ACC }),
      txn('t-2', { type: 'expense', amount: 1200, category: 'food_dining', account_id: ACC }),
      txn('t-3', { type: 'expense', amount: 800, category: 'groceries', account_id: ACC }),
    ],
    budgets: [], budgetAllocations: [], goals: [], debts: [], assets: [], recurring: [],
    accounts: [{ id: ACC, household_id: HID, kind: 'bank', name: 'HDFC', currency: 'INR', opening_balance: 50000,
      is_default: true, is_archived: false, reconciliation_offset: 0, reconciliation_log: [], payment_modes: [],
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null }],
    memberCount: 2,
    rates: [],
    profile: { display_name: 'Rohan Mehta', default_currency: 'INR', language: 'en', date_format: 'dmy' },
    household: { type: 'family', base_currency: 'INR', language: 'en', payoff_strategy: 'avalanche', extra_payment: 0 },
    email: '',
    ...p,
  };
}

/** A deterministic model: classify as `id`, phrase by echoing the computed facts. */
const fakeModel = (id: string, reply?: string): ModelCall => async ({ system, user }) => {
  if (system.includes('classify')) return JSON.stringify({ id, entities: {}, confidence: 0.9 });
  const parsed = JSON.parse(user) as { data: Record<string, unknown> };
  return reply ?? `Here you go: ${Object.values(parsed.data).join(' · ')}`;
};

describe('Ask Vyact on the server (W4)', () => {
  it('CON-UNIT-W4-001 · the context from rows is the one the app builds (same summary, members, rates rule)', () => {
    const r = rows();
    const ctx = contextFromRows(r);
    const profile = profileFromRows(r.profile, r.household, '');
    const txns = r.transactions.map((x) => mapCloudRow('transactions', x) as Transaction);
    const accounts = r.accounts.map((x) => mapCloudRow('accounts', x) as Account);
    const app = buildSafeSummary(txns, [], [], [], [], profile, { ...DEFAULT_RATES }, accounts, []);
    app.household.members = 2;
    expect(ctx.summary).toEqual(app);
    expect(ctx.baseCurrency).toBe('INR');
    expect(ctx.rates).toEqual(DEFAULT_RATES);                                  // no saved rates → the defaults
    expect(contextFromRows(rows({ rates: [{ currency_code: 'USD', rate_to_usd: 1 }, { currency_code: 'INR', rate_to_usd: '84' }] })).rates)
      .toEqual({ USD: 1, INR: 84 });
    expect(ctx.accounts).toEqual([{ id: ACC, name: 'HDFC', kind: 'bank' }]);
  });

  it('CON-UNIT-W4-002 · the generated bundle gives the SAME turn as the source', async () => {
    for (const [question, intent] of [['how am I doing', 'interpret.status'], ['how much did I spend this month', 'interpret.lookup'],
      ['how long will my money last', 'forecast.runway']] as const) {
      const src = await answerOnServer(question, contextFromRows(rows()), fakeModel(intent));
      const gen = await bundle.answerOnServer(question, bundle.contextFromRows(rows()), fakeModel(intent));
      expect({ ...gen, seed: undefined }, question).toEqual({ ...src, seed: undefined });
      expect(src.intentId, question).toBe(intent);
    }
  });

  it('CON-UNIT-W4-003 · an invented figure is discarded on the server path too', async () => {
    const turn = await bundle.answerOnServer('how am I doing', bundle.contextFromRows(rows()),
      fakeModel('interpret.status', 'Your net worth is ₹99,99,999.'));
    expect(turn.intentId).toBe('unavailable');
    expect(turn.reply).toMatch(/couldn't verify the numbers/);
  });

  it('CON-UNIT-W4-004 · WhatsApp rendering: no markdown, numbered chips, the length limit, and no form to open', () => {
    const turn = { reply: '**You spent ₹2,000** this month.\n- Food & Dining: ₹1,200', bucket: 'interpret', intentId: 'interpret.lookup',
      chips: [{ label: 'By category', prompt: 'Where did it go?' }, { label: 'Budgets', prompt: 'How are my budgets?' }],
      clarify: false, allowedFigures: [] } as never;
    const out = renderForWhatsApp(turn, 'https://vyact.app');
    expect(out.text).toBe('You spent ₹2,000 this month.\n• Food & Dining: ₹1,200\n\n1. By category\n2. Budgets\n\nReply with a number, or ask anything.');
    expect(out.chipPrompts).toEqual(['Where did it go?', 'How are my budgets?']);
    const long = renderForWhatsApp({ ...turn as object, reply: 'x'.repeat(9000) } as never, 'https://vyact.app');
    expect(long.text.length).toBeLessThanOrEqual(WHATSAPP_MAX_CHARS);
    expect(renderForWhatsApp({ ...turn as object, seed: { amount: 450 } } as never, 'https://vyact.app').text)
      .toBe('To record it here, send it as one line, like 450 lunch hdfc.');
    expect(renderForWhatsApp({ ...turn as object, recurringSeed: { amount: 649 } } as never, 'https://vyact.app').text)
      .toMatch(/set up in the app.*\/recurring$/);
  });
});
