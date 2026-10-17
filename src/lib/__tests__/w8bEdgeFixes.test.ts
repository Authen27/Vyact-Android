// W8b (v10.83.0) — WhatsApp and Pip Edge robustness from the 2026-10-04 audit. Pure functions are tested
// directly; the webhook and OTP handlers are exercised in whatsappWorkflow.test.ts (W8b-* cases there).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAllowedKeyEnv, checkConfig } from '../../../../supabase/functions/_shared/agent/router';
import { largeSpendAlerts, budgetAlerts, type TxnRow } from '../../../../supabase/functions/_shared/whatsapp-dispatch-rules';
import { runIngestion } from '../../../../supabase/functions/_shared/agent/pipeline';
import type { ExtractionResult } from '../../../../supabase/functions/_shared/agent/types';

const fn = (p: string) => readFileSync(resolve(__dirname, '../../../../supabase/functions', p), 'utf8');

describe('W8b · Edge robustness', () => {
  it('W8b-PIP05-001 · a model config may read only model-provider keys (BE-PIP-05)', () => {
    for (const ok of ['OPENROUTER_API_KEY', 'VLLM_API_KEY', 'GROQ_API_KEY', 'LLM_LOCAL_KEY']) expect(isAllowedKeyEnv(ok), ok).toBe(true);
    for (const no of ['MAILERSEND_API_KEY', 'VAPID_PRIVATE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'WHATSAPP_ACCESS_TOKEN', 'SOME_OTHER_SECRET']) {
      expect(isAllowedKeyEnv(no), no).toBe(false);
    }
    const row = (key: string) => ({ id: 'c', seam: 'assistant', provider: 'openrouter', model: 'm', base_url: 'https://openrouter.ai/api/v1',
      key_env_var: key, enabled: true, priority: 1, params: {} }) as never;
    expect(checkConfig(row('MAILERSEND_API_KEY'))).toMatchObject({ ok: false, code: 'forbidden_key' });
    expect(checkConfig(row('OPENROUTER_API_KEY'))).toMatchObject({ ok: true });
  });

  it('W8b-PAR10-001 · WhatsApp alerts state the figures the app states (INT-PAR-10)', () => {
    const household = { id: 'h', base_currency: 'INR' };
    const members = [{ profile_id: 'me', household_id: 'h' }, { profile_id: 'partner', household_id: 'h' }];
    const txn = (o: Partial<TxnRow>): TxnRow => ({ id: 't', household_id: 'h', created_by: 'me', type: 'expense', amount: 20000, currency: 'INR',
      date: '2026-10-05', category: 'food_dining', account_id: 'a', ...o });
    // A ₹20,000 dinner split, our share ₹8,000: under a ₹10,000 threshold, so no "large spend" alert.
    const split = txn({ extras: { split: { isSplit: true, yourShare: 8000, participants: [] } } });
    expect(largeSpendAlerts({ household, txns: [split], members, thresholds: {}, accountNames: { a: 'HDFC' } })).toEqual([]);
    expect(largeSpendAlerts({ household, txns: [txn({})], members, thresholds: {}, accountNames: { a: 'HDFC' } })[0].values).toEqual(['20,000', 'HDFC']);
    // Budget 80%: the threshold reads the raw share (79.6% is not 80%), the figure is rounded like the bell.
    const budgets = [{ id: 'b', currency: 'INR', period_start: '2026-10-01', period_end: '2026-10-31' }];
    const allocations = [{ budget_id: 'b', category: 'food_dining', amount: 1000 }];
    const at = (spent: number) => budgetAlerts({ household, today: '2026-10-08', budgets, allocations,
      txns: [txn({ amount: spent, created_by: 'me' })], members: [members[0]] });
    expect(at(796)).toEqual([]);
    expect(at(806)[0].values[1]).toBe('81');     // the app says 81% (Math.round); this used to floor to 80
  });

  it('W8b-PIP04-001 · only a TRUSTED learned recipe may write; an untrusted one is drafted (BE-PIP-04)', async () => {
    const recipe = (trusted: boolean | undefined): ExtractionResult => ({
      ok: true, extractor: 'recipe', confidence: 0.95, ...(trusted === undefined ? {} : { trusted }),
      candidate: { amount: 850, currency: 'INR', direction: 'debit', transaction_type: 'expense', accountMask: '4471', category_id: 'groceries', account_alias: 'hdfc' },
    });
    const input = {
      text: 'Rs.850.00 debited from A/c XX4471 to VPA swiggy@ybl', source: 'sms', householdId: 'h1', userId: 'u1', now: new Date('2026-10-08T10:00:00Z'),
      ctx: { households: [{ id: 'h1', name: 'Home' }], accounts: [{ id: 'acc', name: 'HDFC 4471', kind: 'bank', householdId: 'h1' }] },
    } as never;
    const untrusted = await runIngestion(input, { applyRecipe: () => recipe(false) });
    const unknown = await runIngestion(input, { applyRecipe: () => recipe(undefined) });
    expect(untrusted.action.kind).not.toBe('write');
    expect(unknown.action.kind).not.toBe('write');
    expect((await runIngestion(input, { applyRecipe: () => recipe(true) })).action.kind).toBe('write');
    expect(fn('_shared/agent/pipeline.ts')).toMatch(/&& \(extraction\.extractor !== 'recipe' \|\| extraction\.trusted === true\)/);
    expect(fn('_shared/agent/recipeStore.ts')).toMatch(/\? \{ \.\.\.result, trusted: true \}/);
  });

  it('W8b-WA11-001 · a refused send frees its slot; the daily cap counts sends in flight (BE-WA-11)', () => {
    const send = fn('_shared/whatsapp-send.ts');
    expect(send).toMatch(/\.in\('status', \['sent', 'sending'\]\)/);
    expect(send).toMatch(/update\(\{ wa_message_id: `\$\{slot\}:failed:\$\{crypto\.randomUUID\(\)\}`, status: 'failed',/);
  });

  it('W8b-PIP07-001 · gateway failures are logged; the config hint goes to admins only (BE-PIP-07)', () => {
    const gw = fn('ask-vyact/index.ts');
    expect(gw).toMatch(/console\.error\('\[ask-vyact\] provider failure', \{ requestId, code: result\.code, status, provider: config\.provider, model: config\.model \}\)/);
    expect(gw).toMatch(/from\('admin_roles'\)\.select\('user_id'\)\.eq\('user_id', user\.id\)\.maybeSingle\(\)/);
    expect(gw).toMatch(/\.\.\.\(showHint \? \{ hint: result\.hint \} : \{\}\)/);
    expect(gw).not.toMatch(/^\s+hint: result\.hint,$/m);
  });

  it('W8b-WA06-002 · a resend keeps the wrong guesses already made (BE-WA-06)', () => {
    const send = fn('whatsapp-send-otp/index.ts');
    expect(send).toMatch(/select\('created_at, attempts'\)/);
    expect(send).toMatch(/attempts: Number\(\(recent as \{ attempts\?: number \} \| null\)\?\.attempts \?\? 0\),/);
  });
});
