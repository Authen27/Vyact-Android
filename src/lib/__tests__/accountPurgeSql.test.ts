import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// W1b (audit 2026-10-04) — immediate one-transaction account purge, server-checked re-auth for
// erase, and 90-day WhatsApp retention. The fixture keeps the baseline's NO ACTION foreign keys
// to auth.users, so the FK fix in the migration is exercised for real.

const db = new PGlite();
const ME = '10000000-0000-4000-8000-0000000000a1';
const PARTNER = '10000000-0000-4000-8000-0000000000a2';
const SOLO = '20000000-0000-4000-8000-0000000000b1';     // only ME
const SHARED = '20000000-0000-4000-8000-0000000000b2';   // PARTNER owns, ME is a member
const MINE = '20000000-0000-4000-8000-0000000000b3';     // ME owns, PARTNER is a member

const MIGRATIONS = [
  '20261009120100_w1a_ownership_rules.sql',
  '20261010120000_w1b_account_purge.sql',
  '20261010120100_w1b_whatsapp_retention.sql',
];
const LEDGER = ['budgets', 'budget_allocations', 'goals', 'debts', 'assets', 'accounts', 'recurring_schedules', 'saved_views', 'net_worth_snapshots'];

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create table profiles (id uuid primary key references auth.users(id) on delete cascade, deletion_scheduled_for timestamptz);
    create table households (id uuid primary key, onboarding jsonb not null default '{}',
      created_by uuid not null constraint households_created_by_fkey references auth.users(id));
    create table memberships (id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade,
      user_id uuid references auth.users(id) on delete cascade, role text not null);
    create function role_in(h_id uuid) returns text language sql stable security definer set search_path = public as
      $$ select role from memberships where household_id = h_id and user_id = auth.uid() limit 1 $$;
    create table invitations (id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade, invited_email text not null,
      invited_by uuid not null constraint invitations_invited_by_fkey references auth.users(id), accepted_at timestamptz);
    create table transactions (id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade,
      created_by uuid constraint transactions_created_by_fkey references auth.users(id));
    create table activity_log (id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade,
      actor_id uuid constraint activity_log_actor_id_fkey references auth.users(id),
      action text not null check (action in ('created','updated','deleted','invited','accepted','removed','role_changed','transferred')),
      entity_type text not null, entity_id uuid, changes jsonb);
    ${LEDGER.map(t => `create table ${t} (id uuid primary key default gen_random_uuid(), household_id uuid not null references households(id) on delete cascade);`).join('\n')}
    create table shared_splits (id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id) on delete cascade);
    create table shared_split_shares (id uuid primary key default gen_random_uuid(),
      split_id uuid references shared_splits(id) on delete cascade, settled_user_id uuid references auth.users(id));
    create table whatsapp_inbound_messages (wa_message_id text primary key,
      profile_id uuid references profiles(id) on delete set null,
      household_id uuid references households(id) on delete set null,
      payload jsonb, created_at timestamptz not null default now());
    create table whatsapp_identities (profile_id uuid primary key references profiles(id) on delete cascade,
      phone_number text not null, household_id uuid not null references households(id) on delete cascade);
    create table whatsapp_preferences (profile_id uuid primary key references profiles(id) on delete cascade);
    create table whatsapp_pending_turns (id uuid primary key default gen_random_uuid(),
      profile_id uuid not null references profiles(id) on delete cascade, expires_at timestamptz not null default now());
    create table whatsapp_verification_otps (id uuid primary key default gen_random_uuid(),
      profile_id uuid not null references profiles(id) on delete cascade, expires_at timestamptz not null default now());
    create table push_subscriptions (id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade);
    create function request_account_deletion() returns timestamptz language sql as $$ select now() $$;
  `);
  for (const f of MIGRATIONS) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  }
}, 60000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);
    delete from whatsapp_inbound_messages; delete from push_subscriptions; delete from shared_splits;
    delete from households; delete from profiles; delete from auth.users;
    insert into auth.users values ('${ME}', 'me@example.com'), ('${PARTNER}', 'partner@example.com');
    insert into profiles (id) values ('${ME}'), ('${PARTNER}');
    insert into households (id, created_by) values ('${SOLO}', '${ME}'), ('${SHARED}', '${PARTNER}'), ('${MINE}', '${ME}');
    insert into memberships (household_id, user_id, role) values
      ('${SOLO}', '${ME}', 'owner'), ('${SHARED}', '${PARTNER}', 'owner'), ('${SHARED}', '${ME}', 'member'),
      ('${MINE}', '${ME}', 'owner'), ('${MINE}', '${PARTNER}', 'member');
    insert into transactions (household_id, created_by) values ('${SOLO}', '${ME}'), ('${SHARED}', '${ME}'), ('${SHARED}', '${PARTNER}');
    insert into activity_log (household_id, actor_id, action, entity_type) values ('${SHARED}', '${ME}', 'created', 'transaction');
    insert into invitations (household_id, invited_email, invited_by) values ('${SHARED}', 'friend@example.com', '${ME}'),
      ('${SHARED}', 'me@example.com', '${PARTNER}');
    insert into whatsapp_inbound_messages (wa_message_id, profile_id, household_id, payload) values
      ('m-me', '${ME}', '${SHARED}', '{"text":"450 lunch"}'), ('m-partner', '${PARTNER}', '${SHARED}', '{"text":"hi"}');
    insert into whatsapp_identities values ('${ME}', '+911', '${SHARED}');
    insert into push_subscriptions (user_id) values ('${ME}'), ('${PARTNER}');
    with s as (insert into shared_splits (owner_user_id) values ('${PARTNER}') returning id)
      insert into shared_split_shares (split_id, settled_user_id) select id, '${ME}' from s;`);
});

const count = async (sql: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0].n;
const recentAmr = (uid: string, secondsAgo: number) => db.exec(`
  select set_config('request.jwt.claim.sub', '${uid}', false);
  select set_config('request.jwt.claims', '{"sub":"${uid}","amr":[{"method":"otp","timestamp":' || (extract(epoch from now())::bigint - ${secondsAgo}) || '}]}', false);`);

describe('W1b · account purge (migration 20261010120000)', () => {
  it('CON-UNIT-W1-010 - an owner whose household has other members must transfer first; nothing changes', async () => {
    await expect(db.query('select purge_account($1)', [ME])).rejects.toThrow(/transfer_required/);
    expect(await count(`memberships where user_id = '${ME}'`)).toBe(3);
    expect(await count(`households where id = '${SOLO}'`)).toBe(1);
  });

  it('CON-UNIT-W1-011 - after a transfer the purge runs in one step and the login can then be deleted', async () => {
    await db.exec(`update memberships set role = 'owner' where household_id = '${MINE}' and user_id = '${PARTNER}'`);
    const out = await db.query<{ r: { households_deleted: number; memberships_removed: number } }>('select purge_account($1) as r', [ME]);
    expect(out.rows[0].r).toMatchObject({ households_deleted: 1, memberships_removed: 2 });
    expect(await count(`households where id = '${SOLO}'`)).toBe(0);              // their own household is gone…
    expect(await count(`transactions where household_id = '${SOLO}'`)).toBe(0);
    expect(await count(`households where id in ('${SHARED}', '${MINE}')`)).toBe(2);   // …shared ones stay
    expect(await count(`transactions where household_id = '${SHARED}'`)).toBe(2);
    expect(await count(`whatsapp_inbound_messages where wa_message_id = 'm-me'`)).toBe(0);
    expect(await count(`whatsapp_inbound_messages where wa_message_id = 'm-partner'`)).toBe(1);
    expect(await count(`whatsapp_identities`)).toBe(0);
    expect(await count(`push_subscriptions where user_id = '${ME}'`)).toBe(0);
    expect(await count(`invitations where invited_email = 'me@example.com'`)).toBe(0);
    expect(await count(`profiles where id = '${ME}'`)).toBe(0);
    // The auth delete used to fail on NO ACTION FKs; history now stops naming them instead.
    await db.exec(`delete from auth.users where id = '${ME}'`);
    expect(await count(`transactions where household_id = '${SHARED}' and created_by is null`)).toBe(1);
    expect(await count(`activity_log where actor_id is null`)).toBe(1);
    expect(await count(`invitations where invited_email = 'friend@example.com'`)).toBe(0);   // sent by them: gone
    expect(await count(`shared_split_shares where settled_user_id is null`)).toBe(1);
    expect(await count(`households where created_by is null`)).toBe(1);                      // MINE outlives its creator
  });

  it('CON-UNIT-W1-012 - only the service role can purge; the 30-day schedule is gone', async () => {
    const grants = await db.query<{ grantee: string }>(`select grantee from information_schema.routine_privileges
      where routine_name = 'purge_account' order by grantee`);
    expect(grants.rows.map(r => r.grantee)).not.toContain('authenticated');
    expect(grants.rows.map(r => r.grantee)).toContain('service_role');
    expect(await count(`pg_proc where proname = 'request_account_deletion'`)).toBe(0);
  });

  it('CON-UNIT-W1-013 - erase needs a sign-in within 10 minutes, checked on the server (XC-PRV-04)', async () => {
    await recentAmr(ME, 3600);                                       // signed in an hour ago, idle
    await expect(db.query('select erase_household_data($1)', [SOLO])).rejects.toThrow(/reauth_required/);
    expect(await count(`transactions where household_id = '${SOLO}'`)).toBe(1);
    await recentAmr(ME, 30);                                         // just confirmed the emailed code
    await db.query('select erase_household_data($1)', [SOLO]);
    expect(await count(`transactions where household_id = '${SOLO}'`)).toBe(0);
  });
});

describe('W1b · WhatsApp retention (migration 20261010120100)', () => {
  it('CON-UNIT-W1-014 - messages older than 90 days are deleted; newer ones stay', async () => {
    await db.exec(`update whatsapp_inbound_messages set created_at = now() - interval '91 days' where wa_message_id = 'm-me'`);
    const out = await db.query<{ r: { messages: number } }>('select purge_old_whatsapp_messages(90) as r');
    expect(out.rows[0].r.messages).toBe(1);
    expect((await db.query<{ wa_message_id: string }>('select wa_message_id from whatsapp_inbound_messages')).rows)
      .toEqual([{ wa_message_id: 'm-partner' }]);
    await expect(db.query('select purge_old_whatsapp_messages(0)')).rejects.toThrow(/invalid_retention_days/);
  });

  it('CON-UNIT-W1-015 - a household being deleted takes its WhatsApp messages with it', async () => {
    await db.exec(`delete from households where id = '${SHARED}'`);
    expect(await count('whatsapp_inbound_messages')).toBe(0);
  });
});
