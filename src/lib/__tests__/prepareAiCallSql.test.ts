import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// v10.107.1 — prepare_ai_call(): the gateway's membership check and quota reservation in one round
// trip, for auth.uid() only. Runs the real migrations on PGlite.

const db = new PGlite();
const ME = '10000000-0000-4000-8000-0000000000e1';
const OTHER = '10000000-0000-4000-8000-0000000000e2';
const HOME = '20000000-0000-4000-8000-0000000000f1';
const ELSEWHERE = '20000000-0000-4000-8000-0000000000f2';

type Answer = { member: boolean | null; reservation_id: string | null; quota: string };
const as = async <T>(role: 'authenticated' | 'anon', sub: string | null, fn: () => Promise<T>): Promise<T> => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role'); }
};
const prepare = (household: string | null, cap: number | null, reserve = true, surface = 'chat') =>
  as('authenticated', ME, async () => (await db.query<{ r: Answer }>(
    `select public.prepare_ai_call($1, 'assistant', $2, $3, $4) as r`, [household, surface, cap, reserve])).rows[0].r);
const gatewayRows = async () => (await db.query<{ n: number }>(
  `select count(*)::int as n from ai_usage where user_id = '${ME}' and source = 'gateway' and ts > now() - interval '1 hour'`)).rows[0].n;
const setConfigs = (sql: string) => db.exec(`delete from ai_model_configs; ${sql}`);

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
    create table ai_model_configs (id uuid primary key default gen_random_uuid(), seam text not null, provider text not null,
      model text not null, base_url text, key_env_var text, params jsonb, enabled boolean not null default false, priority int default 0);
    create table ai_usage (
      id uuid primary key default gen_random_uuid(), household_id uuid, user_id uuid default auth.uid(),
      ts timestamptz not null default now(), surface text not null default 'chat',
      intent text, sentiment text, sentiment_score numeric, message_len integer,
      backend text, tier text, provider text, model text, prompt_tokens integer, completion_tokens integer,
      cost_usd numeric(12,6), latency_ms integer, outcome text, tool_calls integer, helpful boolean, tap_depth integer,
      constraint ai_usage_outcome_chk check (outcome is null or outcome in ('ok','error','blocked','fallback','clarify','reserved')));
    grant usage on schema public to authenticated, anon;
    insert into auth.users values ('${ME}'), ('${OTHER}');
    insert into profiles values ('${ME}'), ('${OTHER}');
    insert into households values ('${HOME}'), ('${ELSEWHERE}');
    insert into memberships values ('${HOME}', '${ME}'), ('${ELSEWHERE}', '${OTHER}');
  `);
  for (const m of ['20261011120100_w1c_ai_usage_source.sql', '20261027120000_ai_usage_stage_ms.sql', '20261028120000_prepare_ai_call.sql']) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${m}`, import.meta.url), 'utf8'));
  }
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`reset role; delete from ai_usage;`);
  await setConfigs(`insert into ai_model_configs (seam, provider, model, base_url, enabled, priority)
    values ('assistant', 'bedrock', 'amazon.nova-lite-v1:0', 'https://bedrock-runtime.ap-southeast-2.amazonaws.com', true, 120);`);
});

describe('prepare_ai_call() (v10.107.1)', () => {
  it('PIP-GW-020 · a member under the cap gets one gateway reservation, for themselves', async () => {
    const r = await prepare(HOME, 200);
    expect(r).toMatchObject({ member: true, quota: 'ok' });
    expect(r.reservation_id).toMatch(/^[0-9a-f-]{36}$/);
    const row = (await db.query<{ user_id: string; household_id: string; outcome: string; source: string; backend: string }>(
      `select user_id, household_id, outcome, source, backend from ai_usage where id = $1`, [r.reservation_id])).rows[0];
    expect(row).toEqual({ user_id: ME, household_id: HOME, outcome: 'reserved', source: 'gateway', backend: 'llm' });
    // No household named: no membership answer, still a reservation.
    expect(await prepare(null, 200)).toMatchObject({ member: null, quota: 'ok' });
  });

  it('PIP-GW-021 · a household the caller is not in: member false, nothing reserved', async () => {
    expect(await prepare(ELSEWHERE, 200)).toEqual({ member: false, reservation_id: null, quota: 'skipped' });
    expect(await gatewayRows()).toBe(0);
  });

  it('PIP-GW-022 · at the cap: exceeded, nothing reserved; the same count as reserve_ai_usage (gateway rows of 24 h)', async () => {
    expect((await prepare(HOME, 2)).quota).toBe('ok');
    expect((await prepare(HOME, 2)).quota).toBe('ok');
    expect(await prepare(HOME, 2)).toEqual({ member: true, reservation_id: null, quota: 'exceeded' });
    expect(await gatewayRows()).toBe(2);
    // The app's own analytics rows do not count against the cap.
    await db.exec(`insert into ai_usage (user_id, household_id, backend, outcome, source) values ('${ME}', '${HOME}', 'llm', 'ok', 'client')`);
    expect((await prepare(HOME, 3)).quota).toBe('ok');
  });

  it('PIP-GW-023 · OFF writes nothing: no enabled row, a row piloted on someone else, or a relay without the caller', async () => {
    await setConfigs(`insert into ai_model_configs (seam, provider, model, base_url, enabled) values ('assistant', 'bedrock', 'm', 'https://x', false);`);
    expect((await prepare(HOME, 200)).quota).toBe('skipped');
    await setConfigs(`insert into ai_model_configs (seam, provider, model, base_url, enabled, params)
      values ('assistant', 'vllm', 'm', 'https://x', true, '{"allowed_user_ids":["${OTHER}"]}');`);
    expect((await prepare(HOME, 200)).quota).toBe('skipped');
    await setConfigs(`insert into ai_model_configs (seam, provider, model, base_url, enabled)
      values ('assistant', 'claude-code-relay', 'relay', 'https://claude-code.relay', true);`);
    expect((await prepare(HOME, 200)).quota).toBe('skipped');
    await setConfigs(`insert into ai_model_configs (seam, provider, model, base_url, enabled) values ('whatsapp', 'bedrock', 'm', 'https://x', true);`);
    expect((await prepare(HOME, 200)).quota).toBe('skipped');
    expect(await gatewayRows()).toBe(0);
    // The caller on the allowlist (relay or pilot) does get a reservation.
    await setConfigs(`insert into ai_model_configs (seam, provider, model, base_url, enabled, params)
      values ('assistant', 'claude-code-relay', 'relay', 'https://claude-code.relay', true, '{"allowed_user_ids":["${ME}"]}');`);
    expect((await prepare(HOME, 200)).quota).toBe('ok');
  });

  it('PIP-GW-024 · nothing is reserved when not asked, with no cap, or with a cap above 1,000', async () => {
    expect(await prepare(HOME, 200, false)).toEqual({ member: true, reservation_id: null, quota: 'skipped' });
    expect((await prepare(HOME, null)).quota).toBe('skipped');
    expect((await prepare(HOME, 1001)).quota).toBe('skipped');
    expect(await gatewayRows()).toBe(0);
  });

  it('PIP-GW-025 · only a signed-in caller, only real surfaces; anon cannot run it', async () => {
    await expect(as('authenticated', null, () => db.query(`select public.prepare_ai_call(null, 'assistant', 'chat', 200, true)`)))
      .rejects.toThrow(/not_authenticated/);
    await expect(prepare(HOME, 200, true, 'anything')).rejects.toThrow(/invalid_surface/);
    await expect(as('anon', null, () => db.query(`select public.prepare_ai_call(null, 'assistant', 'chat', 200, true)`)))
      .rejects.toThrow(/permission denied/);
    expect(await gatewayRows()).toBe(0);
  });
});
