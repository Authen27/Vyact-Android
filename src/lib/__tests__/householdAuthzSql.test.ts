import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// W1a (audit 2026-10-04) — household authorization, run against the real migrations in a
// focused PGlite fixture (only the tables and helpers they touch, shaped like the baseline).

const db = new PGlite();
const H = '20000000-0000-4000-8000-000000000001';
const H2 = '20000000-0000-4000-8000-000000000002';
const owner = '10000000-0000-4000-8000-00000000000a';
const admin = '10000000-0000-4000-8000-00000000000b';
const viewer = '10000000-0000-4000-8000-00000000000c';
const outsider = '10000000-0000-4000-8000-00000000000d';   // a viewer's throwaway second account
const platformAdmin = '10000000-0000-4000-8000-00000000000e';

const MIGRATIONS = [
  '20261009120000_w1a_drop_replace_rpcs.sql',
  '20261009120100_w1a_ownership_rules.sql',
  '20261009120200_w1a_retire_child_role.sql',
  '20261009120300_w1a_whatsapp_identity_follows_membership.sql',
  '20261009120400_w1a_admin_roles_no_ledger_reads.sql',
];
const LEDGER = ['transactions', 'budgets', 'goals', 'debts', 'assets', 'accounts', 'recurring_schedules', 'budget_allocations', 'notifications'];

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table households (id uuid primary key);
    create table memberships (
      id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade,
      user_id uuid,
      role text not null check (role in ('owner','admin','member','viewer','child')),
      household_role text);
    create table invitations (
      id uuid primary key default gen_random_uuid(), household_id uuid not null,
      role text not null check (role in ('admin','member','viewer','child')));
    create table whatsapp_identities (
      profile_id uuid primary key, phone_number text not null,
      household_id uuid not null references households(id) on delete cascade);
    create table admin_roles (user_id uuid primary key, role text not null);
    create function is_member(h_id uuid) returns boolean language sql stable security definer set search_path = public as
      $$ select exists (select 1 from memberships where household_id = h_id and user_id = auth.uid()) $$;
    create function role_in(h_id uuid) returns text language sql stable security definer set search_path = public as
      $$ select role from memberships where household_id = h_id and user_id = auth.uid() limit 1 $$;
    create function is_admin(min_role text) returns boolean language sql stable security definer set search_path = public as
      $$ select exists (select 1 from admin_roles where user_id = auth.uid()) $$;
    grant execute on function is_member(uuid), role_in(uuid), is_admin(text) to authenticated;
    ${LEDGER.map(t => `create table ${t} (id uuid primary key default gen_random_uuid(), household_id uuid not null);
      alter table ${t} enable row level security;
      create policy "admins read all ${t}" on ${t} for select using (is_admin('roles'));
      grant select, insert, update, delete on ${t} to authenticated;`).join('\n')}
    create table saved_views (id uuid primary key default gen_random_uuid(), user_id uuid);
    alter table saved_views enable row level security;
    create policy "saved_views_self" on saved_views for select using (user_id = auth.uid() or is_admin('roles'));
    grant select on saved_views to authenticated;
    -- the eight replace_* RPCs exist before W1a
    ${['transactions', 'budgets', 'goals', 'debts', 'assets', 'memberships', 'accounts', 'saved_views']
      .map(e => `create function replace_${e}(h uuid, rows jsonb) returns void language sql as $$ select $$;`).join('\n')}
  `);
  for (const f of MIGRATIONS) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  }
}, 60000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);
    delete from whatsapp_identities; delete from invitations; delete from memberships; delete from households;
    ${LEDGER.map(t => `delete from ${t};`).join(' ')} delete from admin_roles;
    insert into households values ('${H}'), ('${H2}');
    insert into memberships (household_id, user_id, role) values
      ('${H}', '${owner}', 'owner'), ('${H}', '${admin}', 'admin'), ('${H}', '${viewer}', 'viewer'),
      ('${H2}', '${outsider}', 'owner');`);
});

const as = (uid: string) => db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
const roleOf = async (uid: string, h = H) =>
  (await db.query<{ role: string }>('select role from memberships where household_id = $1 and user_id = $2', [h, uid])).rows[0]?.role;

describe('W1a · household authorization (migrations 20261009120000–120400)', () => {
  it('CON-UNIT-W1-001 - the eight replace_* RPCs are gone (DB-SEC-01)', async () => {
    const left = await db.query<{ proname: string }>(`select proname from pg_proc where proname like 'replace\\_%'`);
    expect(left.rows).toEqual([]);
  });

  it('CON-UNIT-W1-002 - a non-member can no longer promote anyone (the NULL <> owner hole, DB-SEC-02)', async () => {
    await as(outsider);
    await expect(db.query('select transfer_ownership($1, $2)', [H, viewer])).rejects.toThrow(/only_owner_can_transfer/);
    expect(await roleOf(viewer)).toBe('viewer');
  });

  it('CON-UNIT-W1-003 - only the owner transfers, only to an existing member; the old owner becomes admin', async () => {
    await as(admin);
    await expect(db.query('select transfer_ownership($1, $2)', [H, viewer])).rejects.toThrow(/only_owner_can_transfer/);
    await as(owner);
    await expect(db.query('select transfer_ownership($1, $2)', [H, outsider])).rejects.toThrow(/not_a_member/);
    await expect(db.query('select transfer_ownership($1, $2)', [H, owner])).rejects.toThrow(/invalid_transfer_target/);
    await db.query('select transfer_ownership($1, $2)', [H, admin]);
    expect(await roleOf(admin)).toBe('owner');
    expect(await roleOf(owner)).toBe('admin');
  });

  it('CON-UNIT-W1-004 - a household with members always keeps an owner', async () => {
    await expect(db.exec(`delete from memberships where household_id = '${H}' and user_id = '${owner}'`))
      .rejects.toThrow(/household_needs_an_owner/);
    await expect(db.exec(`update memberships set role = 'admin' where household_id = '${H}' and user_id = '${owner}'`))
      .rejects.toThrow(/household_needs_an_owner/);
    expect(await roleOf(owner)).toBe('owner');
    // Promote first, then demote — fine inside one transaction (checked at commit).
    await db.exec(`begin; update memberships set role = 'owner' where household_id = '${H}' and user_id = '${admin}';
      update memberships set role = 'admin' where household_id = '${H}' and user_id = '${owner}'; commit;`);
    expect(await roleOf(admin)).toBe('owner');
  });

  it('CON-UNIT-W1-005 - deleting a whole household, or the last member leaving, is not blocked', async () => {
    await db.exec(`delete from households where id = '${H}'`);
    expect((await db.query('select 1 from memberships where household_id = $1', [H])).rows).toHaveLength(0);
    await db.exec(`delete from memberships where household_id = '${H2}' and user_id = '${outsider}'`);
    expect((await db.query('select 1 from memberships where household_id = $1', [H2])).rows).toHaveLength(0);
  });

  it('CON-UNIT-W1-006 - the child app role is stored as member, now and from old clients (INT-HH-12)', async () => {
    await db.exec(`insert into memberships (household_id, user_id, role, household_role) values ('${H}', gen_random_uuid(), 'child', 'child');
      insert into invitations (household_id, role) values ('${H}', 'child');`);
    const m = await db.query<{ role: string; household_role: string }>(`select role, household_role from memberships where household_role = 'child'`);
    expect(m.rows).toEqual([{ role: 'member', household_role: 'child' }]);   // relationship label untouched
    expect((await db.query<{ role: string }>('select role from invitations')).rows).toEqual([{ role: 'member' }]);
    await db.exec(`update memberships set role = 'child' where user_id = '${viewer}'`);
    expect(await roleOf(viewer)).toBe('member');
  });

  it('CON-UNIT-W1-007 - removing a member deletes their WhatsApp link, and only theirs (BE-WA-01)', async () => {
    await db.exec(`insert into whatsapp_identities values ('${viewer}', '+911', '${H}'), ('${admin}', '+912', '${H}')`);
    await db.exec(`delete from memberships where household_id = '${H}' and user_id = '${viewer}'`);
    const left = await db.query<{ profile_id: string }>('select profile_id from whatsapp_identities order by phone_number');
    expect(left.rows).toEqual([{ profile_id: admin }]);
  });

  it('CON-UNIT-W1-008 - a platform admin who is not a member reads no household ledger rows (ADM-03)', async () => {
    for (const t of LEDGER) await db.exec(`insert into ${t} (household_id) values ('${H}')`);
    await db.exec(`insert into admin_roles values ('${platformAdmin}', 'super')`);
    await db.exec(`set role authenticated`);
    await as(platformAdmin);
    for (const t of LEDGER) {
      expect((await db.query(`select 1 from ${t}`)).rows, t).toHaveLength(0);
    }
    await as(viewer);                                          // members still read their own household
    for (const t of LEDGER) expect((await db.query(`select 1 from ${t}`)).rows, t).toHaveLength(1);
    await db.exec('reset role');
  });
});
