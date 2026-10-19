import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// T5C-002..003 — v10.122.0 (T5c; audit FE-PIP-09; owner, 19 Oct 2026: "admin counts read only the server's
// rows"). admin_ai_usage_summary() reads call figures from the gateway's rows (one per model call) and turn
// figures from the app's rows (one per turn that called the model). It used to count both together, so a
// two-call turn showed as three "interactions" and the cost figures mixed in rows that carry none.
// Runs the real migration on PGlite.

const db = new PGlite();
const ANN = '10000000-0000-4000-8000-0000000000a1';
const BEN = '10000000-0000-4000-8000-0000000000a2';
type Summary = Record<string, unknown> & {
  total: number; users: number; last7: number; last30: number; byIntent: Record<string, number>;
  bySentiment: Record<string, number>; segments: { userId: string; interactions: number }[];
  byModel: Record<string, number>; byBackend: Record<string, number>; tokens30: { prompt: number; completion: number };
  cost30Usd: number; errorRate30: number; fallbackRate30: number; latencyMsP50: number;
};

beforeAll(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function public.is_admin(tier text) returns boolean language sql stable as
      $$ select current_setting('test.admin', true) = 'yes' $$;
    create table ai_usage (
      id uuid primary key default gen_random_uuid(), household_id uuid, user_id uuid, source text,
      ts timestamptz not null default now(), surface text not null default 'chat',
      intent text, sentiment text, sentiment_score numeric, message_len integer,
      backend text, tier text, provider text, model text, prompt_tokens integer, completion_tokens integer,
      cost_usd numeric(12,6), latency_ms integer, outcome text, tool_calls integer, helpful boolean, tap_depth integer);
    insert into auth.users values ('${ANN}', 'ann@example.com'), ('${BEN}', 'ben@example.com');

    -- Ann asked two questions; each called the model twice (classify, phrase). Ben asked one, its phrase
    -- call failed. Every turn wrote an app row; every call a gateway row.
    insert into ai_usage (user_id, source, intent, sentiment, sentiment_score, backend, outcome, latency_ms) values
      ('${ANN}', 'client', 'spend_lookup', 'neutral', 0, 'llm', 'ok', 4000),
      ('${ANN}', 'client', 'affordability', 'positive', 0.5, 'llm', 'fallback', 6000),
      ('${BEN}', 'client', 'spend_lookup', 'negative', -0.5, 'llm', 'error', 9000);
    insert into ai_usage (user_id, source, backend, provider, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, outcome, ts) values
      ('${ANN}', 'gateway', 'llm', 'bedrock', 'nova-lite', 300, 20, 0.0001, 700, 'ok', now()),
      ('${ANN}', 'gateway', 'llm', 'bedrock', 'nova-lite', 900, 150, 0.0004, 1500, 'ok', now()),
      ('${ANN}', 'gateway', 'llm', 'bedrock', 'nova-lite', 280, 18, 0.0001, 650, 'ok', now() - interval '10 days'),
      ('${ANN}', 'gateway', 'llm', 'bedrock', 'nova-lite', 870, 140, 0.0004, 1400, 'ok', now() - interval '10 days'),
      ('${BEN}', 'gateway', 'llm', 'bedrock', 'nova-lite', 310, 21, 0.0001, 720, 'ok', now()),
      ('${BEN}', 'gateway', 'llm', 'bedrock', 'nova-lite', 0, 0, 0, 10000, 'error', now());
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261105120000_t5c_ai_usage_summary_sources.sql', import.meta.url), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });

const summary = async () => {
  await db.exec(`select set_config('test.admin', 'yes', false)`);
  return (await db.query<{ s: Summary }>('select public.admin_ai_usage_summary() as s')).rows[0].s;
};

describe('admin_ai_usage_summary reads each figure from the rows that hold it (FE-PIP-09)', () => {
  it('T5C-002 · call figures come from the gateway (6 calls, not 9 rows); turn figures from the app (3 turns)', async () => {
    const s = await summary();
    expect(s.total).toBe(6);                       // model calls: was 9 (every row)
    expect(s.users).toBe(2);
    expect(s.last7).toBe(4);
    expect(s.last30).toBe(6);
    expect(s.byModel).toEqual({ 'nova-lite': 6 });  // was { n/a: 3, nova-lite: 6 }
    expect(s.tokens30).toEqual({ prompt: 2660, completion: 349 });
    expect(Number(s.cost30Usd)).toBeCloseTo(0.0011, 6);
    expect(s.errorRate30).toBeCloseTo(1 / 6, 4);    // one call of six failed
    expect(s.latencyMsP50).toBe(720);              // calls' latency, not turns' (was 1500 over every row)

    expect(s.byIntent).toEqual({ spend_lookup: 2, affordability: 1 });   // was { other: 6, … }
    expect(s.bySentiment).toEqual({ neutral: 1, positive: 1, negative: 1 });
    expect(s.byBackend).toEqual({ llm: 3 });
    expect(s.fallbackRate30).toBeCloseTo(1 / 3, 4);  // one turn of three
    expect(s.segments.map(x => [x.userId, x.interactions])).toEqual([[ANN, 2], [BEN, 1]]);
  });

  it('T5C-003 · still admins only', async () => {
    await db.exec(`select set_config('test.admin', 'no', false)`);
    await expect(db.query('select public.admin_ai_usage_summary()')).rejects.toThrow(/forbidden: admin role required/);
  });
});
