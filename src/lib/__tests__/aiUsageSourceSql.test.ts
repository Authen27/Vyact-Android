import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// W1c (audit 2026-10-04 BE-PIP-03 / DB-SEC-11) — the AI spend gate is the server's: a client row
// carries no cost, tokens, provider or model and cannot be a reservation, and the daily model-call
// cap counts only the server's own rows.

const db = new PGlite();
const ME = '10000000-0000-4000-8000-0000000000e1';
const HOME = '20000000-0000-4000-8000-0000000000f1';

const asClient = async <T>(fn: () => Promise<T>): Promise<T> => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${ME}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec('reset role'); }
};
const reserve = (cap: number) =>
  db.query<{ id: string }>(`select public.reserve_ai_usage('${ME}', '${HOME}', 'chat', ${cap}) as id`);

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table profiles (id uuid primary key references auth.users(id));
    create table households (id uuid primary key);
    create table memberships (household_id uuid references households(id), user_id uuid references auth.users(id));
    create function is_member(h uuid) returns boolean language sql stable security definer set search_path = public as
      $$ select exists (select 1 from memberships where household_id = h and user_id = auth.uid()) $$;
    create table ai_usage (
      id uuid primary key default gen_random_uuid(), household_id uuid, user_id uuid default auth.uid(),
      ts timestamptz not null default now(), surface text not null default 'chat',
      intent text, sentiment text, sentiment_score numeric, message_len integer,
      backend text, tier text, provider text, model text, prompt_tokens integer, completion_tokens integer,
      cost_usd numeric(12,6), latency_ms integer, outcome text, tool_calls integer, helpful boolean, tap_depth integer,
      constraint ai_usage_outcome_chk check (outcome is null or outcome in ('ok','error','blocked','fallback','clarify','reserved')));
    alter table ai_usage enable row level security;
    create policy ai_usage_insert on ai_usage for insert to authenticated
      with check (is_member(household_id) and user_id = (select auth.uid()));
    create policy ai_usage_select on ai_usage for select to authenticated using (user_id = (select auth.uid()));
    grant usage on schema public to authenticated;
    grant select, insert on ai_usage to authenticated;
    insert into auth.users values ('${ME}');
    insert into profiles values ('${ME}');
    insert into households values ('${HOME}');
    insert into memberships values ('${HOME}', '${ME}');
    -- Rows from before the migration: one gateway reservation, one finalised gateway call, one app row.
    insert into ai_usage (user_id, household_id, backend, outcome, ts) values ('${ME}', '${HOME}', 'llm', 'reserved', now() - interval '2 days');
    insert into ai_usage (user_id, household_id, backend, outcome, provider, cost_usd, ts) values ('${ME}', '${HOME}', 'llm', 'ok', 'vllm', 0.01, now() - interval '2 days');
    insert into ai_usage (user_id, household_id, backend, outcome, intent, message_len, ts) values ('${ME}', '${HOME}', 'llm', 'ok', 'lookup', 20, now() - interval '2 days');
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261011120100_w1c_ai_usage_source.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261027120000_ai_usage_stage_ms.sql', import.meta.url), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec(`reset role; delete from ai_usage where ts > now() - interval '1 day';`); });

describe('ai_usage is metered by the server (W1c)', () => {
  it('CON-UNIT-W1-030 · a client row keeps its analytics but no cost, tokens, model or reservation', async () => {
    await asClient(() => db.exec(`insert into ai_usage (household_id, backend, outcome, intent, message_len, latency_ms,
        provider, model, prompt_tokens, completion_tokens, cost_usd, tool_calls, source)
      values ('${HOME}', 'llm', 'reserved', 'lookup', 12, 900, 'openrouter', 'big-model', 9999, 9999, 99999, 3, 'gateway')`));
    const row = (await db.query<Record<string, unknown>>(`select * from ai_usage where ts > now() - interval '1 day'`)).rows[0];
    expect(row).toMatchObject({ source: 'client', intent: 'lookup', message_len: 12, latency_ms: 900, backend: 'llm',
      provider: null, model: null, prompt_tokens: null, completion_tokens: null, cost_usd: null, tool_calls: null, outcome: null });
    // The server's own insert (service role / function owner) is the gateway's.
    await db.exec(`insert into ai_usage (user_id, household_id, backend, outcome, provider, cost_usd) values ('${ME}', '${HOME}', 'llm', 'ok', 'vllm', 0.02)`);
    const server = (await db.query<{ source: string; cost_usd: string }>(`select source, cost_usd from ai_usage where provider = 'vllm' and ts > now() - interval '1 day'`)).rows[0];
    expect(server).toEqual({ source: 'gateway', cost_usd: '0.020000' });
  });

  it('CON-UNIT-W1-031 · existing rows are labelled; the daily cap counts only the server\'s calls', async () => {
    const labelled = await db.query<{ source: string; n: number }>(
      `select source, count(*)::int as n from ai_usage group by source order by source`);
    expect(labelled.rows).toEqual([{ source: 'client', n: 1 }, { source: 'gateway', n: 2 }]);

    for (let i = 0; i < 5; i++) {
      await asClient(() => db.exec(`insert into ai_usage (household_id, backend, outcome, intent, message_len) values ('${HOME}', 'llm', 'ok', 'lookup', 10)`));
    }
    await reserve(2);
    await reserve(2);
    await expect(reserve(2)).rejects.toThrow(/quota_exceeded/);
    const reserved = await db.query<{ source: string }>(`select source from ai_usage where outcome = 'reserved' and ts > now() - interval '1 day'`);
    expect(reserved.rows).toEqual([{ source: 'gateway' }, { source: 'gateway' }]);
  });
});

// v10.106.3 — Pip answer timings: the app row carries per-stage numbers, and nothing that could be text.
describe('ai_usage.stage_ms holds timings only (v10.106.3)', () => {
  it('PIP-LAT-020 · a client row keeps its stage timings beside the W1c analytics', async () => {
    await asClient(() => db.exec(`insert into ai_usage (household_id, backend, outcome, intent, message_len, latency_ms, stage_ms)
      values ('${HOME}', 'llm', 'ok', 'lookup', 12, 4200, '{"classify": 1500, "phrase": 2100, "phraseCalls": 1, "after": 40}')`));
    const row = (await db.query<{ source: string; stage_ms: unknown }>(`select source, stage_ms from ai_usage where ts > now() - interval '1 day'`)).rows[0];
    expect(row).toEqual({ source: 'client', stage_ms: { classify: 1500, phrase: 2100, phraseCalls: 1, after: 40 } });
  });

  it('PIP-LAT-021 · text, nesting, odd keys and oversized objects are refused, so no message can be stored there', async () => {
    const many = JSON.stringify(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${String.fromCharCode(97 + i)}`, i])));
    for (const bad of ['{"classify": "how much did I spend on food"}', '{"classify": {"ms": 1}}', '{"how much on food": 1}',
      '[1, 2]', '"text"', many]) {
      await expect(asClient(() => db.exec(`insert into ai_usage (household_id, backend, stage_ms) values ('${HOME}', 'llm', '${bad}')`)), bad)
        .rejects.toThrow(/ai_usage_stage_ms_chk/);
    }
  });
});
