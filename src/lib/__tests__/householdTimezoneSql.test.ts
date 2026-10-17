import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// W3a (owner decision D12) — the household's zone, for the server's "today": India time for every
// existing household, the creator's device zone for a new one, validated, and stamped by the owner's
// device only once.

const db = new PGlite();
const OWNER = '10000000-0000-4000-8000-0000000000a1';
const MEMBER = '10000000-0000-4000-8000-0000000000a2';
const TRAVELLER = '10000000-0000-4000-8000-0000000000a3';
const OLD = '20000000-0000-4000-8000-0000000000b1';

const as = async (user: string | null, sql: string) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role authenticated;`);
  try { return await db.query<Record<string, unknown>>(sql); } finally { await db.exec('reset role'); }
};
const zoneOf = async (id: string) =>
  (await db.query<{ timezone: string; set: boolean }>(`select timezone, timezone_set_at is not null as set from households where id = '${id}'`)).rows[0];

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table households (id uuid primary key default gen_random_uuid(), name text not null default 'Home',
      created_by uuid references auth.users(id));
    create table memberships (household_id uuid references households(id) on delete cascade,
      user_id uuid references auth.users(id), role text not null);
    create function role_in(h uuid) returns text language sql stable security definer set search_path = public as
      $$ select role from memberships where household_id = h and user_id = auth.uid() limit 1 $$;
    grant usage on schema public to authenticated;
    insert into auth.users (id, raw_user_meta_data) values
      ('${OWNER}', '{}'), ('${MEMBER}', '{}'), ('${TRAVELLER}', '{"timezone":"America/New_York"}');
    insert into households (id, created_by) values ('${OLD}', '${OWNER}');
    insert into memberships values ('${OLD}', '${OWNER}', 'owner'), ('${OLD}', '${MEMBER}', 'member');
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261012120000_w3a_household_timezone.sql', import.meta.url), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`reset role; update households set timezone = 'Asia/Kolkata', timezone_set_at = null where id = '${OLD}';
    delete from households where id <> '${OLD}';`);
});

describe('household time zone (W3a)', () => {
  it('CON-UNIT-W3-D12-007 · existing households read India time; a new one takes its creator’s signup zone; only real zones are stored', async () => {
    expect(await zoneOf(OLD)).toEqual({ timezone: 'Asia/Kolkata', set: false });
    const made = await db.query<{ id: string }>(`insert into households (created_by) values ('${TRAVELLER}') returning id`);
    expect(await zoneOf(made.rows[0].id)).toEqual({ timezone: 'America/New_York', set: true });
    await db.exec(`update auth.users set raw_user_meta_data = '{"timezone":"Mars/Olympus"}' where id = '${OWNER}'`);
    const odd = await db.query<{ id: string }>(`insert into households (created_by) values ('${OWNER}') returning id`);
    expect(await zoneOf(odd.rows[0].id)).toEqual({ timezone: 'Asia/Kolkata', set: false });
    await expect(db.exec(`update households set timezone = 'Not/AZone' where id = '${OLD}'`)).rejects.toThrow(/invalid_timezone/);
  });

  it('CON-UNIT-W3-D12-008 · the owner’s device stamps its zone once; a member cannot; a bad zone is refused', async () => {
    await expect(as(MEMBER, `select set_household_timezone('${OLD}', 'Europe/London')`)).rejects.toThrow(/only_owner_sets_timezone/);
    await expect(as(null, `select set_household_timezone('${OLD}', 'Europe/London')`)).rejects.toThrow(/not_signed_in/);
    await expect(as(OWNER, `select set_household_timezone('${OLD}', 'Atlantis/Lost')`)).rejects.toThrow(/invalid_timezone/);

    const first = await as(OWNER, `select set_household_timezone('${OLD}', 'Europe/London') as tz`);
    expect(first.rows[0].tz).toBe('Europe/London');
    // A second device elsewhere does not move an already-set zone…
    const second = await as(OWNER, `select set_household_timezone('${OLD}', 'Asia/Tokyo') as tz`);
    expect(second.rows[0].tz).toBe('Europe/London');
    // …unless the owner chooses to (p_only_if_unset = false).
    const chosen = await as(OWNER, `select set_household_timezone('${OLD}', 'Asia/Tokyo', false) as tz`);
    expect(chosen.rows[0].tz).toBe('Asia/Tokyo');
    expect(await zoneOf(OLD)).toEqual({ timezone: 'Asia/Tokyo', set: true });
  });
});
