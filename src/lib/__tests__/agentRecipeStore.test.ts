// Vyact Agent — recipe persistence seam (architecture §3.2).
//
// The point of these tests is the SECOND message. The learned-recipe cache only
// pays for itself if a format learned once extracts for free forever after, so
// the load-bearing assertion is that message #2 of a known format is parsed
// deterministically with the model never called.
import { describe, it, expect, vi } from 'vitest';
import {
  InMemoryRecipeStore, prepareRecipe, learnRecipe,
} from '../../../../supabase/functions/_shared/agent/recipeStore';
import { deriveRecipe } from '../../../../supabase/functions/_shared/agent/recipe';
import { smsSignature } from '../../../../supabase/functions/_shared/agent/signature';
import { runIngestion } from '../../../../supabase/functions/_shared/agent/pipeline';

const SMS_1 =
  'Rs.850.00 debited from A/c XX4471 on 14-08 to VPA swiggy@ybl. Ref 4429911. Avl Bal Rs.12,340.00';
const SMS_2 =
  'Rs.1,299.50 debited from A/c XX9920 on 02-09 to VPA amazon@apl. Ref 8123344. Avl Bal Rs.61,204.55';

const CANDIDATE_1 = {
  amount: 850, currency: 'INR', direction: 'debit' as const,
  transaction_type: 'expense' as const, accountMask: '4471',
  date: '2026-08-14', merchant: 'swiggy@ybl', refId: '4429911',
};

// Clock must sit AFTER both fixture dates (14-08 and 02-09): the validator
// correctly rejects a future-dated extraction, so an earlier clock would fail
// the fixture rather than the code.
const NOW = new Date('2026-09-20T10:00:00Z');
const CTX = {
  accounts: [
    { name: 'HDFC Bank', kind: 'bank', maskLast4: '4471' },
    { name: 'Cash', kind: 'cash' },
  ],
  households: [{ id: 'h1', name: 'Mallela Household' }],
  baseCurrency: 'INR',
  now: NOW,
};

describe('InMemoryRecipeStore', () => {
  it('round-trips a recipe by signature', async () => {
    const store = new InMemoryRecipeStore();
    const sig = smsSignature(SMS_1);
    const derived = deriveRecipe(SMS_1, CANDIDATE_1, sig);
    expect(derived).not.toBeNull();
    expect(await learnRecipe(store, derived)).toBe(true);
    expect(await store.get(sig)).toBeTruthy();
  });

  it('learnRecipe treats a null derivation as a normal non-event', async () => {
    const store = new InMemoryRecipeStore();
    expect(await learnRecipe(store, null)).toBe(false);
    expect(store.size()).toBe(0);
  });
});

describe('prepareRecipe', () => {
  it('reports a miss on an unknown format without throwing', async () => {
    const prepared = await prepareRecipe(new InMemoryRecipeStore(), SMS_1);
    expect(prepared.recipe).toBeUndefined();
    expect(prepared.apply).toBeUndefined();
    expect(prepared.signature).toBe(smsSignature(SMS_1));
  });

  it('treats a store failure as a cache MISS, never an error', async () => {
    // Losing the cache must cost money and latency — never correctness.
    const broken = {
      get: () => Promise.reject(new Error('db down')),
      put: () => Promise.resolve(),
      observe: () => Promise.resolve(),
    };
    const prepared = await prepareRecipe(broken, SMS_1);
    expect(prepared.recipe).toBeUndefined();
  });

  it('rejects a malformed row rather than feeding it to the extractor', async () => {
    const junk = {
      get: () => Promise.resolve({ signature: 'x', nonsense: true } as never),
      put: () => Promise.resolve(),
      observe: () => Promise.resolve(),
    };
    const prepared = await prepareRecipe(junk, SMS_1);
    expect(prepared.recipe).toBeUndefined();
  });

  it('never applies a recipe learned from a DIFFERENT format', async () => {
    const store = new InMemoryRecipeStore();
    const sig = smsSignature(SMS_1);
    await learnRecipe(store, deriveRecipe(SMS_1, CANDIDATE_1, sig));
    const prepared = await prepareRecipe(store, SMS_1);
    expect(prepared.apply?.('some-other-signature', SMS_1)).toBeUndefined();
  });
});

describe('the second message is free', () => {
  it('extracts a DIFFERENT message of the same format with no model call', async () => {
    const store = new InMemoryRecipeStore();
    const sig1 = smsSignature(SMS_1);
    await learnRecipe(store, deriveRecipe(SMS_1, CANDIDATE_1, sig1));

    // Same bank format, different amount / date / account / merchant.
    expect(smsSignature(SMS_2)).toBe(sig1);

    const prepared = await prepareRecipe(store, SMS_2);
    expect(prepared.recipe).toBeTruthy();

    const result = prepared.apply?.(prepared.signature, SMS_2);
    expect(result?.ok).toBe(true);
    expect(result?.extractor).toBe('recipe');
    // The whole point: the new message's OWN values, not the learned ones.
    expect(result?.candidate.amount).toBe(1299.5);
    expect(result?.candidate.amount).not.toBe(850);
    expect(result?.candidate.accountMask).toBe('9920');
  });

  it('does not mistake the available balance for the amount', async () => {
    const store = new InMemoryRecipeStore();
    await learnRecipe(store, deriveRecipe(SMS_1, CANDIDATE_1, smsSignature(SMS_1)));
    const prepared = await prepareRecipe(store, SMS_2);
    const result = prepared.apply?.(prepared.signature, SMS_2);
    expect(result?.candidate.amount).not.toBe(61204.55);
  });

  it('drives the PIPELINE without ever calling the model', async () => {
    const store = new InMemoryRecipeStore();
    await learnRecipe(store, deriveRecipe(SMS_1, CANDIDATE_1, smsSignature(SMS_1)));
    const prepared = await prepareRecipe(store, SMS_2);

    const llmExtract = vi.fn();
    const { action, trace } = await runIngestion(
      { text: SMS_2, channel: 'whatsapp', householdId: 'h1', ctx: CTX },
      { applyRecipe: prepared.apply, llmExtract },
    );

    // This is the cost lever for the entire design.
    expect(llmExtract).not.toHaveBeenCalled();
    expect(trace.extractor).toBe('recipe');
    expect(['write', 'draft', 'ask']).toContain(action.kind);
  });

  it('falls back to the model on an unknown format', async () => {
    const prepared = await prepareRecipe(new InMemoryRecipeStore(), SMS_2);
    const llmExtract = vi.fn(async () => ({
      ok: false as const, candidate: {}, extractor: 'llm' as const,
      confidence: 0, reason: 'not_parseable' as const,
    }));
    await runIngestion(
      { text: SMS_2, channel: 'whatsapp', householdId: 'h1', ctx: CTX },
      { applyRecipe: prepared.apply, llmExtract },
    );
    expect(llmExtract).toHaveBeenCalled();
  });
});

describe('trust gating', () => {
  it('a fresh recipe is usable but not yet trusted', async () => {
    const store = new InMemoryRecipeStore();
    await learnRecipe(store, deriveRecipe(SMS_1, CANDIDATE_1, smsSignature(SMS_1)));
    const prepared = await prepareRecipe(store, SMS_2);
    expect(prepared.trusted).toBe(false);
    const result = prepared.apply?.(prepared.signature, SMS_2);
    // Reduced confidence ⇒ the pipeline drafts for a human instead of writing.
    expect(result?.confidence).toBeLessThan(0.95);
  });

  it('confirmations promote it to trusted', async () => {
    const store = new InMemoryRecipeStore();
    const sig = smsSignature(SMS_1);
    await learnRecipe(store, deriveRecipe(SMS_1, CANDIDATE_1, sig));
    for (let i = 0; i < 5; i++) await store.observe(sig, 'confirmed');
    expect((await prepareRecipe(store, SMS_2)).trusted).toBe(true);
  });

  it('corrections demote it — banks do silently change formats', async () => {
    const store = new InMemoryRecipeStore();
    const sig = smsSignature(SMS_1);
    await learnRecipe(store, deriveRecipe(SMS_1, CANDIDATE_1, sig));
    for (let i = 0; i < 10; i++) await store.observe(sig, 'confirmed');
    for (let i = 0; i < 4; i++) await store.observe(sig, 'corrected');
    expect((await prepareRecipe(store, SMS_2)).trusted).toBe(false);
  });
});
