import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// JOIN-001..008 — v10.114.0 (Track T2, part a; audit INT-HH-07, INT-HH-09, DB-INT-11, INT-HH-06,
// INT-CON-07, XC-PRV-12; owner decisions 18 Oct 2026). Who belongs to a household, and how they join:
// only by accepting an invitation, once, into a household with room; one membership per person; the
// participant name lookup answers only for people already known to the caller.
// Runs the real migrations (the member limit, the invitation inbox, then T2a) over a fixture shaped like
// the baseline, with the memberships RLS policies as they stand today. PGlite has one connection, so two
// truly concurrent accepts can't be raced here: the single-use claim, the unique index and the locks
// are each checked directly instead.

const db = new PGlite();
const MIGRATIONS = ['20261007120000_household_types_v2.sql', '20261022120000_invitation_inbox.sql',
  '20261031120000_t2a_memberships_invitations.sql'];
const T2A = readFileSync(new URL(`../../../../supabase/migrations/${MIGRATIONS[2]}`, import.meta.url), 'utf8');

const ASHA = '10000000-0000-4000-8000-00000000000a';    // owns H (family) and C (couple)
const RAVI = '10000000-0000-4000-8000-00000000000b';    // member of H (with a duplicate row), on Asha's split
const SAM = '10000000-0000-4000-8000-00000000000c';     // joins through links
const DAN = '10000000-0000-4000-8000-00000000000d';     // a stranger: settled one of Eve's splits, nothing of Asha's
const MEERA = '10000000-0000-4000-8000-00000000000e';   // second joiner for the Couple household
const H = '20000000-0000-4000-8000-000000000001';
const C = '20000000-0000-4000-8000-000000000002';
const RAVI_OWNER_ROW = '30000000-0000-4000-8000-000000000001';
const RAVI_MEMBER_ROW = '30000000-0000-4000-8000-000000000002';
const LINK_H = 'link-for-h';
const LINK_C1 = 'link-for-couple-1';
const LINK_C2 = 'link-for-couple-2';

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;

    create table profiles (id uuid primary key, display_name text, phone_number text, phone_verified_at timestamptz,
      whatsapp_household_id uuid, deactivated_at timestamptz, deletion_requested_at timestamptz);
    -- Audit S1's guard: only the service role touches the phone columns.
    create function public.guard_whatsapp_profile_columns() returns trigger language plpgsql as $$
    declare v_claims text; v_role text;
    begin
      v_claims := nullif(current_setting('request.jwt.claims', true), '');
      v_role := case when v_claims is null then '' else coalesce(v_claims::jsonb ->> 'role', '') end;
      if v_role = 'service_role' then return new; end if;
      if new.phone_number is not distinct from old.phone_number and new.phone_verified_at is not distinct from old.phone_verified_at
         and new.whatsapp_household_id is not distinct from old.whatsapp_household_id then return new; end if;
      raise exception 'phone columns are server-managed' using errcode = '42501';
    end $$;
    create trigger trg_guard_whatsapp_profile_columns before update on profiles for each row execute function guard_whatsapp_profile_columns();

    create table households (id uuid primary key default gen_random_uuid(), name text not null, type text not null, created_by uuid);
    create table memberships (
      id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade,
      user_id uuid,
      role text not null check (role in ('owner','admin','member','viewer','child')),
      display_name text not null,
      household_role text check (household_role in ('primary','partner','child','elder')),
      joined_at timestamptz not null default now());
    create table invitations (
      id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade,
      invited_email text not null, invited_by uuid not null,
      role text not null check (role in ('admin','member','viewer','child')),
      household_role text,
      token text not null unique default gen_random_uuid()::text,
      expires_at timestamptz not null default (now() + interval '14 days'),
      accepted_at timestamptz, created_at timestamptz not null default now());
    create table activity_log (id uuid primary key default gen_random_uuid(), household_id uuid not null, actor_id uuid,
      action text not null, entity_type text not null, entity_id uuid, changes jsonb, created_at timestamptz not null default now());
    create table transactions (id uuid primary key default gen_random_uuid(), household_id uuid,
      member_id uuid references memberships(id) on delete set null, initiated_by uuid references memberships(id) on delete set null);
    create table recurring_schedules (id uuid primary key default gen_random_uuid(),
      owner_member_id uuid references memberships(id) on delete set null);
    create table whatsapp_identities (profile_id uuid, household_id uuid, phone_number text);
    create table whatsapp_inbound_messages (profile_id uuid); create table whatsapp_pending_turns (profile_id uuid);
    create table whatsapp_verification_otps (profile_id uuid); create table whatsapp_preferences (profile_id uuid);
    create table push_subscriptions (user_id uuid);
    create table shared_splits (id uuid primary key default gen_random_uuid(), owner_user_id uuid, owner_household_id uuid);
    create table shared_split_shares (id uuid primary key default gen_random_uuid(), split_id uuid references shared_splits(id) on delete cascade, email text);

    create function public.is_member(h uuid) returns boolean language sql stable security definer as
      $$ select exists (select 1 from memberships where household_id = h and user_id = auth.uid()) $$;
    create function public.role_in(h uuid) returns text language sql stable security definer as
      $$ select role from memberships where household_id = h and user_id = auth.uid() limit 1 $$;
    create function public.my_email() returns text language sql stable security definer as
      $$ select lower(email) from auth.users where id = auth.uid() $$;

    -- Membership rules as they stand on main (db/schema.sql).
    alter table memberships enable row level security;
    create policy "memberships_read" on memberships for select to authenticated using (is_member(household_id));
    create policy "owners and admins add members" on memberships for insert with check (
      role_in(household_id) = 'owner' or (role_in(household_id) = 'admin' and role <> 'owner'));
    create policy "owners change roles; admins change non-owners" on memberships for update
      using (role_in(household_id) = 'owner' or (role_in(household_id) = 'admin' and role <> 'owner'))
      with check (role_in(household_id) = 'owner' or (role_in(household_id) = 'admin' and role <> 'owner'));
    grant select, insert, update, delete on memberships to authenticated;
    grant select on profiles to authenticated;

    -- W1a: a WhatsApp link ends with the membership (T2a refines it).
    create function public.unlink_whatsapp_on_membership_delete() returns trigger language plpgsql security definer as $$
    begin delete from whatsapp_identities where profile_id = OLD.user_id and household_id = OLD.household_id; return null; end $$;
    create trigger trg_unlink_whatsapp after delete on memberships for each row execute function unlink_whatsapp_on_membership_delete();

    -- The baseline's functions T2a replaces or drops.
    create function public.accept_invitation(invite_token text) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.accept_invitation(invite_token uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.leave_household(h_id uuid) returns void language plpgsql security definer as $$ begin end $$;
    create function public.resolve_participant_names(p_emails text[]) returns table(email text, display_name text)
      language sql stable security definer as
      $$ select lower(u.email), p.display_name from auth.users u join profiles p on p.id = u.id
          where lower(u.email) = any (select lower(e) from unnest(p_emails) e) $$;

    -- The state before T2a: Ravi has two rows in H (an old duplicate) and things point at the lower one.
    insert into auth.users values
      ('${ASHA}', 'asha@example.com', now()), ('${RAVI}', 'ravi@example.com', now()), ('${SAM}', 'sam@example.com', now()),
      ('${DAN}', 'dan@example.com', now()), ('${MEERA}', 'meera@example.com', now());
    insert into profiles (id, display_name, phone_number, phone_verified_at) values
      ('${ASHA}', 'Asha', '+919800000001', now()), ('${RAVI}', 'Ravi', null, null), ('${SAM}', 'Sam', null, null),
      ('${DAN}', 'Dan', null, null), ('${MEERA}', 'Meera', null, null);
    insert into households values ('${H}', 'Sharma family', 'family', '${ASHA}'), ('${C}', 'Asha and partner', 'couple', '${ASHA}');
    insert into memberships (id, household_id, user_id, role, display_name, joined_at) values
      (gen_random_uuid(), '${H}', '${ASHA}', 'owner', 'Asha', now() - interval '2 years'),
      ('${RAVI_OWNER_ROW}', '${H}', '${RAVI}', 'admin', 'Ravi', now() - interval '1 year'),
      ('${RAVI_MEMBER_ROW}', '${H}', '${RAVI}', 'member', 'Ravi', now() - interval '2 years'),
      (gen_random_uuid(), '${C}', '${ASHA}', 'owner', 'Asha', now());
    insert into transactions (household_id, member_id, initiated_by) values ('${H}', '${RAVI_MEMBER_ROW}', '${RAVI_MEMBER_ROW}');
    insert into recurring_schedules (owner_member_id) values ('${RAVI_MEMBER_ROW}');
    insert into whatsapp_identities values ('${RAVI}', '${H}', '+919800000002');
    insert into shared_splits (id, owner_user_id, owner_household_id) values
      ('40000000-0000-4000-8000-000000000001', '${ASHA}', '${H}'), ('40000000-0000-4000-8000-000000000002', '${MEERA}', null);
    insert into shared_split_shares (split_id, email) values
      ('40000000-0000-4000-8000-000000000001', 'sam@example.com'), ('40000000-0000-4000-8000-000000000002', 'dan@example.com');
  `);
  for (const f of MIGRATIONS) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into invitations (household_id, invited_email, invited_by, role, token) values
    ('${H}', '(shareable link)', '${ASHA}', 'member', '${LINK_H}'),
    ('${C}', '(shareable link)', '${ASHA}', 'member', '${LINK_C1}')`);
}, 60000);
afterAll(async () => { await db.close(); });

async function asUser<T>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await db.query<T>(sql, params); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0];
const count = async (sql: string) => (await one<{ n: number }>(`select count(*)::int as n from (${sql}) q`)).n;

describe('memberships (INT-HH-07, DB-INT-11, INT-HH-06)', () => {
  it('JOIN-001 · an owner can no longer add a stranger directly; roles still change; a membership can\'t be re-pointed', async () => {
    await expect(asUser(ASHA, `insert into memberships (household_id, user_id, role, display_name) values ($1, $2, 'viewer', 'x')`, [H, DAN]))
      .rejects.toThrow(/row-level security/);
    expect(await count(`select 1 from memberships where user_id = '${DAN}'`)).toBe(0);
    await asUser(ASHA, `update memberships set role = 'member' where id = $1`, [RAVI_OWNER_ROW]);
    expect((await one<{ role: string }>(`select role from memberships where id = '${RAVI_OWNER_ROW}'`)).role).toBe('member');
    await expect(asUser(ASHA, `update memberships set user_id = $1 where id = $2`, [DAN, RAVI_OWNER_ROW]))
      .rejects.toThrow(/membership_identity_fixed/);
    await db.exec(`update memberships set role = 'admin' where id = '${RAVI_OWNER_ROW}'`);
  });

  it('JOIN-002 · a duplicate membership was merged into one (highest role kept), with what pointed at it, and WhatsApp stays linked', async () => {
    expect((await db.query<{ id: string; role: string }>(`select id, role from memberships where user_id = '${RAVI}'`)).rows)
      .toEqual([{ id: RAVI_OWNER_ROW, role: 'admin' }]);
    expect(await one(`select member_id, initiated_by from transactions`)).toEqual({ member_id: RAVI_OWNER_ROW, initiated_by: RAVI_OWNER_ROW });
    expect(await one(`select owner_member_id from recurring_schedules`)).toEqual({ owner_member_id: RAVI_OWNER_ROW });
    expect(await count(`select 1 from whatsapp_identities where profile_id = '${RAVI}'`)).toBe(1);
    await expect(db.exec(`insert into memberships (household_id, user_id, role, display_name) values ('${H}', '${RAVI}', 'member', 'Ravi')`))
      .rejects.toThrow(/uq_memberships_household_user|duplicate key/);
  });

  it('JOIN-003 · the old phone copies on profiles are cleared (the migration acts as the service role)', async () => {
    expect(await one(`select phone_number, phone_verified_at from profiles where id = '${ASHA}'`)).toEqual({ phone_number: null, phone_verified_at: null });
  });
});

describe('joining by invitation (INT-HH-09, DB-INT-11)', () => {
  it('JOIN-004 · a link is single-use: Sam joins once; the next person is refused; the link was claimed atomically', async () => {
    const r = await asUser<{ r: { already_member: boolean } }>(SAM, 'select accept_invitation_link($1) as r', [LINK_H]);
    expect(r.rows[0].r.already_member).toBe(false);
    expect(await count(`select 1 from memberships where household_id = '${H}' and user_id = '${SAM}'`)).toBe(1);
    await expect(asUser(MEERA, 'select accept_invitation_link($1)', [LINK_H])).rejects.toThrow(/not found or expired/);
    expect(await count(`select 1 from memberships where user_id = '${MEERA}'`)).toBe(0);
  });

  it('JOIN-005 · someone already in the household opening a link leaves it usable for the person it was for', async () => {
    await db.exec(`insert into invitations (household_id, invited_email, invited_by, role, token) values ('${H}', 'link', '${ASHA}', 'member', 'second-link-h')`);
    const r = await asUser<{ r: { already_member: boolean } }>(RAVI, 'select accept_invitation_link($1) as r', ['second-link-h']);
    expect(r.rows[0].r.already_member).toBe(true);
    expect((await one<{ accepted_at: string | null }>(`select accepted_at from invitations where token = 'second-link-h'`)).accepted_at).toBeNull();
    await asUser(MEERA, 'select accept_invitation_link($1)', ['second-link-h']);
    expect(await count(`select 1 from memberships where household_id = '${H}' and user_id = '${MEERA}'`)).toBe(1);
  });

  it('JOIN-006 · a Couple household takes one partner: the next join is HOUSEHOLD_FULL; the counts run with the household locked', async () => {
    // Two links waiting for one place (a state the old race could leave; the invitation trigger refuses it today).
    await db.exec(`set session_replication_role = replica;
      insert into invitations (household_id, invited_email, invited_by, role, token) values ('${C}', 'link', '${ASHA}', 'member', '${LINK_C2}');
      set session_replication_role = default;`);
    await asUser(SAM, 'select accept_invitation_link($1)', [LINK_C1]);
    await expect(asUser(MEERA, 'select accept_invitation_link($1)', [LINK_C2])).rejects.toThrow(/HOUSEHOLD_FULL/);
    expect(await count(`select 1 from memberships where household_id = '${C}'`)).toBe(2);
    // The refused accept left its link unclaimed (the whole accept rolled back).
    expect((await one<{ accepted_at: string | null }>(`select accepted_at from invitations where token = '${LINK_C2}'`)).accepted_at).toBeNull();
    // The locks the race needs (PGlite can't run two sessions at once).
    const body = (fn: string) => T2A.slice(T2A.indexOf(`function public.${fn}`), T2A.indexOf('$$;', T2A.indexOf(`function public.${fn}`)));
    expect(body('enforce_household_member_limit')).toMatch(/select type into v_type from households where id = new\.household_id for update;/);
    for (const fn of ['accept_invitation_link', 'accept_invitation_by_id']) {
      expect(body(fn), fn).toMatch(/for update;[\s\S]*perform 1 from (public\.)?households where id = inv\.household_id for update;/);
      expect(body(fn), fn).toMatch(/set accepted_at = now\(\) where id = inv\.id and accepted_at is null;\s*get diagnostics claimed = row_count;/);
    }
  });

  it('JOIN-007 · the legacy accept functions are gone; leaving is null-safe and keeps the last owner', async () => {
    expect(await count(`select 1 from pg_proc where proname = 'accept_invitation'`)).toBe(0);
    await asUser(DAN, 'select leave_household($1)', [H]);                    // not a member: nothing happens
    await expect(asUser(ASHA, 'select leave_household($1)', [C])).rejects.toThrow(/last_owner_cannot_leave/);
    await asUser(MEERA, 'select leave_household($1)', [H]);
    expect(await count(`select 1 from memberships where household_id = '${H}' and user_id = '${MEERA}'`)).toBe(0);
  });
});

describe('the participant name lookup (XC-PRV-12; owner: known emails only)', () => {
  it('JOIN-008 · names only for people already known to the caller; a stranger\'s email gets nothing; at most 200', async () => {
    const asked = ['RAVI@example.com', 'sam@example.com', 'dan@example.com', 'nobody@example.com', ''];
    const r = await asUser<{ email: string; display_name: string }>(ASHA, 'select * from resolve_participant_names($1) order by email', [asked]);
    // Ravi: a co-member of H. Sam: on Asha's split (and now in H). Dan: on Meera's split only — a stranger to Asha.
    expect(r.rows).toEqual([{ email: 'ravi@example.com', display_name: 'Ravi' }, { email: 'sam@example.com', display_name: 'Sam' }]);
    // Dan knows Meera (her split names him): Meera's name resolves for Dan, Asha's doesn't.
    const d = await asUser<{ email: string }>(DAN, 'select email from resolve_participant_names($1)', [['meera@example.com', 'asha@example.com']]);
    expect(d.rows.map(x => x.email)).toEqual(['meera@example.com']);
    await expect(asUser(ASHA, 'select * from resolve_participant_names($1)',
      [Array.from({ length: 201 }, (_, i) => `p${i}@example.com`)])).rejects.toThrow(/too_many_emails/);
    expect((await db.query('select * from resolve_participant_names($1)', [['ravi@example.com']])).rows).toEqual([]);   // signed out
  });
});
