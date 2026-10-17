import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ADM-03 / FE-PUB-01 (owner decision 13 Oct 2026) — admins see who did what and when in the activity
// log, never the values. Step 1 (v10.92.0) adds the feed; step 2 (v10.93.0) makes the table's read
// policy members only. Runs both real migrations over a fixture shaped like the baseline: the
// activity_log table with its pre-W1 read policies, and the real tiered is_admin.

const db = new PGlite();
const MIGRATION = '20261020120000_admin_activity_feed.sql';
const STEP2 = '20261021120000_activity_log_members_only.sql';
const H = '20000000-0000-4000-8000-000000000001';
const H2 = '20000000-0000-4000-8000-000000000002';
const member = '10000000-0000-4000-8000-00000000000a';
const rolesAdmin = '10000000-0000-4000-8000-00000000000b';
const superAdmin = '10000000-0000-4000-8000-00000000000c';
const contentAdmin = '10000000-0000-4000-8000-00000000000d';
const COLUMNS = ['id', 'created_at', 'household_id', 'actor_id', 'action', 'entity_type', 'entity_id'];
const migrationSql = readFileSync(new URL(`../../../../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
const step2Sql = readFileSync(new URL(`../../../../supabase/migrations/${STEP2}`, import.meta.url), 'utf8');

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create table households (id uuid primary key);
    create table memberships (household_id uuid not null references households(id), user_id uuid not null, role text not null);
    create table admin_roles (user_id uuid primary key, role text not null);
    create table activity_log (
      id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade,
      actor_id uuid,
      action text not null check (action in ('created','updated','deleted','invited','accepted','removed','role_changed','transferred')),
      entity_type text not null,
      entity_id uuid,
      changes jsonb,
      created_at timestamptz not null default now());
    create function is_member(h_id uuid) returns boolean language sql stable security definer set search_path = public as
      $$ select exists (select 1 from memberships where household_id = h_id and user_id = auth.uid()) $$;
    -- The baseline's is_admin, tiers and all.
    create function is_admin(min_role text default null) returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from admin_roles where user_id = auth.uid() and case
        when min_role is null then true
        when min_role = 'super' then role = 'super'
        when min_role = 'roles' then role in ('super','roles')
        when min_role = 'content' then role in ('super','content')
        else false end) $$;
    grant execute on function is_member(uuid), is_admin(text) to authenticated;
    alter table activity_log enable row level security;
    create policy "activity_log_read" on activity_log for select to authenticated
      using (is_member(household_id) or is_admin('roles'));
    -- A second admin read under another name, as production may hold (no migration names it here).
    create policy "prod only admin read" on activity_log for select using (is_admin('super'));
    grant select on activity_log to authenticated;
  `);
  await db.exec(migrationSql);
  await db.exec(step2Sql);
}, 60000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);
    delete from activity_log; delete from memberships; delete from admin_roles; delete from households;
    insert into households values ('${H}'), ('${H2}');
    insert into memberships values ('${H}', '${member}', 'owner');
    insert into admin_roles values ('${rolesAdmin}', 'roles'), ('${superAdmin}', 'super'), ('${contentAdmin}', 'content');
    insert into activity_log (household_id, actor_id, action, entity_type, entity_id, changes, created_at) values
      ('${H}',  '${member}', 'created', 'transaction', gen_random_uuid(), '{"amount": 1250, "description": "Dr Mehta clinic"}', '2026-10-01T10:00:00Z'),
      ('${H}',  '${member}', 'updated', 'account',     gen_random_uuid(), '{"name": "HDFC Salary", "opening_balance": 90000}', '2026-10-02T10:00:00Z'),
      ('${H2}', null,        'deleted', 'household',   null,              '{"kind": "erase"}', '2026-10-03T10:00:00Z');`);
});

/** Run `sql` as a signed-in user (the `authenticated` role with that user's id), then reset. */
async function asUser<T>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await db.query<T>(sql, params); }
  finally { await db.exec('reset role'); }
}

describe('admin activity feed (ADM-03 step 1)', () => {
  it('ADM03-001 · an admin of the roles tier sees who, what and when, newest first, and never the values', async () => {
    for (const admin of [rolesAdmin, superAdmin]) {
      const r = await asUser<Record<string, unknown>>(admin, 'select * from admin_activity_feed()');
      expect(r.fields.map(f => f.name)).toEqual(COLUMNS);
      expect(r.rows.map(x => [x.action, x.entity_type, x.household_id])).toEqual([
        ['deleted', 'household', H2], ['updated', 'account', H], ['created', 'transaction', H],
      ]);
      expect(r.rows[1].actor_id).toBe(member);
      expect(r.rows[0].actor_id).toBeNull();
      const text = JSON.stringify(r.rows);
      for (const value of ['1250', 'Dr Mehta', 'HDFC Salary', '90000', 'erase']) expect(text).not.toContain(value);
    }
  });

  it('ADM03-002 · anyone else is refused: a member, a content admin, a signed-out caller', async () => {
    for (const uid of [member, contentAdmin]) {
      await expect(asUser(uid, 'select * from admin_activity_feed()')).rejects.toThrow(/forbidden: admin role required/);
    }
    await db.exec('set role anon');
    try {
      await expect(db.query('select * from admin_activity_feed()')).rejects.toThrow(/permission denied for function admin_activity_feed/);
    } finally { await db.exec('reset role'); }
    const grants = await db.query<{ anon: boolean; authed: boolean; service: boolean }>(`select
      has_function_privilege('anon', 'admin_activity_feed(integer, timestamptz)', 'execute') as anon,
      has_function_privilege('authenticated', 'admin_activity_feed(integer, timestamptz)', 'execute') as authed,
      has_function_privilege('service_role', 'admin_activity_feed(integer, timestamptz)', 'execute') as service`);
    expect(grants.rows[0]).toEqual({ anon: false, authed: true, service: true });
  });

  it('ADM03-003 · it pages back with p_before and keeps the limit between 1 and 1000', async () => {
    const page1 = await asUser<{ created_at: Date; action: string }>(rolesAdmin, 'select * from admin_activity_feed(2)');
    expect(page1.rows.map(r => r.action)).toEqual(['deleted', 'updated']);
    const oldest = page1.rows[1].created_at;
    const page2 = await asUser<{ action: string }>(rolesAdmin, 'select * from admin_activity_feed(2, $1)', [oldest]);
    expect(page2.rows.map(r => r.action)).toEqual(['created']);
    expect((await asUser(rolesAdmin, 'select * from admin_activity_feed(0)')).rows).toHaveLength(1);
    expect((await asUser(rolesAdmin, 'select * from admin_activity_feed(null)')).rows).toHaveLength(3);
    await db.exec(`insert into activity_log (household_id, action, entity_type, created_at)
      select '${H}', 'created', 'transaction', timestamptz '2026-09-01' + n * interval '1 minute' from generate_series(1, 1005) n`);
    expect((await asUser(rolesAdmin, 'select * from admin_activity_feed(5000)')).rows).toHaveLength(1000);
  });

  it('ADM03-004 · step 1 changes no access: members still read their own household\'s log', async () => {
    const own = await asUser<{ household_id: string; changes: unknown }>(member, 'select household_id, changes from activity_log order by created_at');
    expect(own.rows.map(r => r.household_id)).toEqual([H, H]);
    expect(own.rows[0].changes).toEqual({ amount: 1250, description: 'Dr Mehta clinic' });
    // The migration touches no policy and no table; step 2 narrows activity_log_read.
    expect(migrationSql).not.toMatch(/\b(create|drop|alter)\s+(policy|table)\b/i);
  });

  it('ADM03-005 · the function names its columns and never reads `changes`', () => {
    const body = migrationSql.slice(migrationSql.indexOf('create or replace function public.admin_activity_feed'));
    const code = body.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/\bchanges\b/);
    expect(code).not.toMatch(/select\s+\*|a\.\*/i);
    expect(code).toMatch(/security definer set search_path = public, pg_temp/);
  });
});

describe('activity_log is members only (ADM-03 step 2)', () => {
  it('ADM03-006 · an admin who is not a member reads no rows from the table; the feed still serves them', async () => {
    for (const admin of [rolesAdmin, superAdmin]) {
      expect((await asUser(admin, 'select id from activity_log')).rows, admin).toEqual([]);
      expect((await asUser(admin, 'select * from admin_activity_feed()')).rows, admin).toHaveLength(3);
    }
    // A member reads their own household's log, values included, and nobody else's.
    const own = await asUser<{ household_id: string }>(member, 'select household_id from activity_log');
    expect(own.rows.map(r => r.household_id)).toEqual([H, H]);
    // An admin who is also a member reads that household like any member.
    await db.exec(`insert into memberships values ('${H2}', '${rolesAdmin}', 'member')`);
    const asMember = await asUser<{ household_id: string }>(rolesAdmin, 'select household_id from activity_log');
    expect(asMember.rows.map(r => r.household_id)).toEqual([H2]);
  });

  it('ADM03-007 · one read policy is left, members only; every admin read was swept, whatever its name', async () => {
    const policies = await db.query<{ policyname: string; cmd: string; roles: string[] | string; qual: string }>(
      `select policyname, cmd, roles, qual from pg_policies where tablename = 'activity_log'`);
    expect(policies.rows.map(p => [p.policyname, p.cmd])).toEqual([['activity_log_read', 'SELECT']]);
    expect(String(policies.rows[0].roles)).toMatch(/authenticated/);
    expect(policies.rows[0].qual).toMatch(/is_member\(household_id\)/);
    expect(policies.rows[0].qual).not.toMatch(/is_admin/);
    expect(step2Sql).toMatch(/qual ilike '%is_admin%'/);
  });
});
