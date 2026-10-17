import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// #9, step 1 (v10.94.0; owner decisions 13 Oct 2026) — an invitation can be addressed to a person:
// they find it in their bell (Accept / Decline), matched on their CONFIRMED email, and Vyact emails it
// once. Runs the real migrations (the household member limit, then the inbox) over a fixture shaped
// like the baseline.

const db = new PGlite();
const MIGRATIONS = ['20261007120000_household_types_v2.sql', '20261022120000_invitation_inbox.sql'];
const inboxSql = readFileSync(new URL(`../../../../supabase/migrations/${MIGRATIONS[1]}`, import.meta.url), 'utf8');

const OWNER = '10000000-0000-4000-8000-00000000000a';
const OWNER2 = '10000000-0000-4000-8000-00000000000b';
const SAM = '10000000-0000-4000-8000-00000000000c';      // confirmed sam@example.com (signed up as Sam@Example.com)
const EVE = '10000000-0000-4000-8000-00000000000d';      // eve@example.com, NOT confirmed
const OTHER = '10000000-0000-4000-8000-00000000000e';    // confirmed other@example.com
const H = '20000000-0000-4000-8000-000000000001';        // family, owner OWNER
const H2 = '20000000-0000-4000-8000-000000000002';       // couple, owner OWNER2
const H3 = '20000000-0000-4000-8000-000000000003';       // family, OTHER owns it and SAM is already in it
const INV_SAM = '30000000-0000-4000-8000-000000000001';
const INV_OTHER = '30000000-0000-4000-8000-000000000002';
const INV_EVE = '30000000-0000-4000-8000-000000000003';
const INV_EXPIRED = '30000000-0000-4000-8000-000000000004';
const INV_ACCEPTED = '30000000-0000-4000-8000-000000000005';
const INV_LINK = '30000000-0000-4000-8000-000000000006';
const INV_ALREADY = '30000000-0000-4000-8000-000000000007';
const INV_FULL = '30000000-0000-4000-8000-000000000008';

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create table profiles (id uuid primary key, display_name text);
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
      invited_email text not null,
      invited_by uuid not null,
      role text not null check (role in ('admin','member','viewer','child')),
      household_role text,
      token text not null unique default gen_random_uuid()::text,
      expires_at timestamptz not null default (now() + interval '14 days'),
      accepted_at timestamptz,
      created_at timestamptz not null default now());
    create table activity_log (id uuid primary key default gen_random_uuid(), household_id uuid not null, actor_id uuid,
      action text not null, entity_type text not null, entity_id uuid, changes jsonb, created_at timestamptz not null default now());
    -- purge_account also clears these
    create table whatsapp_inbound_messages (profile_id uuid); create table whatsapp_identities (profile_id uuid);
    create table whatsapp_pending_turns (profile_id uuid); create table whatsapp_verification_otps (profile_id uuid);
    create table whatsapp_preferences (profile_id uuid); create table push_subscriptions (user_id uuid);
  `);
  for (const f of MIGRATIONS) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  }
}, 60000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);
    delete from invite_email_log; delete from activity_log; delete from invitations; delete from memberships;
    delete from households; delete from profiles; delete from auth.users;
    insert into auth.users values
      ('${OWNER}', 'asha@example.com', now()), ('${OWNER2}', 'ravi@example.com', now()),
      ('${SAM}', 'Sam@Example.com', now()), ('${EVE}', 'eve@example.com', null), ('${OTHER}', 'other@example.com', now());
    insert into profiles values ('${OWNER}', 'Asha'), ('${OWNER2}', 'Ravi'), ('${SAM}', 'Sam'), ('${OTHER}', '  ');
    insert into households values ('${H}', 'Sharma family', 'family', '${OWNER}'), ('${H2}', 'Ravi and Meera', 'couple', '${OWNER2}'),
      ('${H3}', 'Flat 4B', 'family', '${OTHER}');
    insert into memberships (household_id, user_id, role, display_name, household_role) values
      ('${H}', '${OWNER}', 'owner', 'Asha', 'primary'), ('${H2}', '${OWNER2}', 'owner', 'Ravi', 'primary'),
      ('${H3}', '${OTHER}', 'owner', 'Other', 'primary'), ('${H3}', '${SAM}', 'member', 'Sam', 'partner');
    insert into invitations (id, household_id, invited_email, recipient_email, invited_by, role, household_role, expires_at, accepted_at) values
      ('${INV_SAM}',      '${H}',  'Partner',          'sam@example.com',   '${OWNER}',  'member', 'partner', now() + interval '14 days', null),
      ('${INV_OTHER}',    '${H}',  'Accountant',       'other@example.com', '${OWNER}',  'viewer', null,      now() + interval '14 days', null),
      ('${INV_EVE}',      '${H}',  'Eve',              'eve@example.com',   '${OWNER}',  'member', 'partner', now() + interval '14 days', null),
      ('${INV_EXPIRED}',  '${H}',  'Old',              'sam@example.com',   '${OWNER}',  'member', 'partner', now() - interval '1 day',   null),
      ('${INV_ACCEPTED}', '${H}',  'Done',             'sam@example.com',   '${OWNER}',  'member', 'partner', now() + interval '14 days', now()),
      ('${INV_LINK}',     '${H}',  '(shareable link)', null,                '${OWNER}',  'member', null,      now() + interval '14 days', null),
      ('${INV_ALREADY}',  '${H3}', 'Sam again',        'sam@example.com',   '${OTHER}',  'member', 'partner', now() + interval '14 days', null),
      ('${INV_FULL}',     '${H2}', 'Meera',            'sam@example.com',   '${OWNER2}', 'member', 'partner', now() + interval '14 days', null);`);
});

async function asUser<T>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await db.query<T>(sql, params); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

describe('invitation inbox (#9 step 1)', () => {
  it('INV-001 · the invitee sees invitations addressed to their confirmed email: who, which household, what access, never the token', async () => {
    const r = await asUser<Record<string, unknown>>(SAM, 'select * from my_pending_invitations()');
    expect(r.fields.map(f => f.name)).toEqual(['id', 'household_id', 'household_name', 'household_type', 'invited_by_name',
      'role', 'household_role', 'expires_at', 'created_at']);
    // Not the expired one, the accepted one, the one for a household Sam is already in, or anyone else's.
    expect(r.rows.map(x => x.id).sort()).toEqual([INV_SAM, INV_FULL].sort());
    const sharma = r.rows.find(x => x.id === INV_SAM)!;
    expect(sharma).toMatchObject({ household_id: H, household_name: 'Sharma family', household_type: 'family',
      invited_by_name: 'Asha', role: 'member', household_role: 'partner' });
    expect(JSON.stringify(r.rows)).not.toMatch(/sam@example\.com|shareable link|Partner/);
    // A blank inviter name reads "Someone"; a link-only invitation is nobody's.
    await db.exec(`update invitations set invited_by = '${OTHER}' where id = '${INV_OTHER}'`);
    const other = await asUser<{ id: string; invited_by_name: string }>(OTHER, 'select id, invited_by_name from my_pending_invitations()');
    expect(other.rows).toEqual([{ id: INV_OTHER, invited_by_name: 'Someone' }]);
  });

  it('INV-002 · an unconfirmed address sees nothing and can do nothing; signed-out callers cannot run any of it', async () => {
    expect((await asUser(EVE, 'select * from my_pending_invitations()')).rows).toEqual([]);
    await expect(asUser(EVE, 'select accept_invitation_by_id($1)', [INV_EVE])).rejects.toThrow(/not_signed_in/);
    await expect(asUser(EVE, 'select decline_invitation($1)', [INV_EVE])).rejects.toThrow(/not_signed_in/);
    expect((await one<{ n: number }>(`select count(*)::int as n from invitations where id = '${INV_EVE}'`)).n).toBe(1);
    const g = await one<Record<string, boolean>>(`select
      has_function_privilege('anon', 'my_pending_invitations()', 'execute') as anon_list,
      has_function_privilege('anon', 'accept_invitation_by_id(uuid)', 'execute') as anon_accept,
      has_function_privilege('anon', 'decline_invitation(uuid)', 'execute') as anon_decline,
      has_function_privilege('authenticated', 'accept_invitation_by_id(uuid)', 'execute') as authed_accept,
      has_function_privilege('authenticated', 'my_verified_email()', 'execute') as authed_email,
      has_function_privilege('authenticated', 'claim_invite_email(uuid, uuid, integer)', 'execute') as authed_claim,
      has_function_privilege('service_role', 'claim_invite_email(uuid, uuid, integer)', 'execute') as service_claim`);
    expect(g).toEqual({ anon_list: false, anon_accept: false, anon_decline: false, authed_accept: true,
      authed_email: false, authed_claim: false, service_claim: true });
  });

  it('INV-003 · accepting joins with the invitation\'s access, once; someone else\'s invitation is "not found" and stays', async () => {
    const r = await asUser<{ r: Record<string, unknown> }>(SAM, 'select accept_invitation_by_id($1) as r', [INV_SAM]);
    expect(r.rows[0].r).toMatchObject({ household_id: H, role: 'member', already_member: false });
    expect(await one(`select role, household_role, display_name from memberships where household_id = '${H}' and user_id = '${SAM}'`))
      .toEqual({ role: 'member', household_role: 'partner', display_name: 'Sam' });
    expect((await one<{ a: unknown }>(`select accepted_at as a from invitations where id = '${INV_SAM}'`)).a).not.toBeNull();
    expect(await one(`select action, entity_type, entity_id from activity_log where household_id = '${H}'`))
      .toEqual({ action: 'accepted', entity_type: 'invitation', entity_id: INV_SAM });
    await expect(asUser(SAM, 'select accept_invitation_by_id($1)', [INV_SAM])).rejects.toThrow(/invitation_not_found/);
    await expect(asUser(SAM, 'select accept_invitation_by_id($1)', [INV_OTHER])).rejects.toThrow(/invitation_not_found/);
    await expect(asUser(SAM, 'select accept_invitation_by_id($1)', [INV_EXPIRED])).rejects.toThrow(/invitation_not_found/);
    expect((await one<{ a: unknown }>(`select accepted_at as a from invitations where id = '${INV_OTHER}'`)).a).toBeNull();
    // A missing display name falls back to the address's name part.
    await asUser(OTHER, 'select accept_invitation_by_id($1)', [INV_OTHER]);
    expect(await one(`select display_name, household_role from memberships where household_id = '${H}' and user_id = '${OTHER}'`))
      .toEqual({ display_name: 'other', household_role: null });
  });

  it('INV-004 · a full household refuses the join (HOUSEHOLD_FULL) and the invitation stays open', async () => {
    await db.exec(`insert into memberships (household_id, user_id, role, display_name) values ('${H2}', '${OTHER}', 'member', 'Meera')`);
    await expect(asUser(SAM, 'select accept_invitation_by_id($1)', [INV_FULL])).rejects.toThrow(/HOUSEHOLD_FULL/);
    expect((await one<{ n: number }>(`select count(*)::int as n from memberships where household_id = '${H2}' and user_id = '${SAM}'`)).n).toBe(0);
    expect((await one<{ a: unknown }>(`select accepted_at as a from invitations where id = '${INV_FULL}'`)).a).toBeNull();
  });

  it('INV-005 · an invitation to a household you are already in closes without a second membership', async () => {
    const r = await asUser<{ r: Record<string, unknown> }>(SAM, 'select accept_invitation_by_id($1) as r', [INV_ALREADY]);
    expect(r.rows[0].r).toMatchObject({ household_id: H3, already_member: true });
    expect((await one<{ n: number }>(`select count(*)::int as n from memberships where household_id = '${H3}' and user_id = '${SAM}'`)).n).toBe(1);
  });

  it('INV-006 · declining removes only your own open invitation', async () => {
    expect((await asUser<{ d: boolean }>(SAM, 'select decline_invitation($1) as d', [INV_SAM])).rows[0].d).toBe(true);
    expect((await asUser<{ d: boolean }>(SAM, 'select decline_invitation($1) as d', [INV_OTHER])).rows[0].d).toBe(false);
    expect((await asUser<{ d: boolean }>(SAM, 'select decline_invitation($1) as d', [INV_ACCEPTED])).rows[0].d).toBe(false);
    const left = await db.query<{ id: string }>(`select id from invitations where id in ('${INV_SAM}', '${INV_OTHER}', '${INV_ACCEPTED}') order by id`);
    expect(left.rows.map(r => r.id)).toEqual([INV_OTHER, INV_ACCEPTED].sort());
  });

  it('INV-007 · the address is stored lower-case and email-shaped; a link-only invitation has none', async () => {
    const add = (email: string) => db.query(`insert into invitations (household_id, invited_email, recipient_email, invited_by, role)
      values ($1, 'x', $2, $3, 'member')`, [H, email, OWNER]);
    for (const bad of ['Sam@Example.com', ' sam@example.com', 'not-an-email', 'a@b', 'two@@example.com']) {
      await expect(add(bad), bad).rejects.toThrow(/ck_invitation_recipient_email/);
    }
    await add('new.person+home@example.co.in');
    await db.query(`insert into invitations (household_id, invited_email, invited_by, role) values ($1, '(shareable link)', $2, 'member')`, [H, OWNER]);
  });

  it('INV-008 · the link accept now joins when the invitation has no relationship label (it used to fail)', async () => {
    await db.exec(`update invitations set household_role = null where id = '${INV_LINK}'`);
    const token = (await one<{ token: string }>(`select token from invitations where id = '${INV_LINK}'`)).token;
    const r = await asUser<{ r: Record<string, unknown> }>(EVE, 'select accept_invitation_link($1) as r', [token]);
    expect(r.rows[0].r).toMatchObject({ household_id: H, already_member: false });
    expect(await one(`select household_role from memberships where household_id = '${H}' and user_id = '${EVE}'`)).toEqual({ household_role: null });
    expect(inboxSql).not.toMatch(/coalesce\(inv\.household_role, 'member'\)/);
  });

  it('INV-009 · one email per invitation, ever; a daily cap per sender that revoking does not reset', async () => {
    const claim = async (inv: string, cap = 20) =>
      (await one<{ c: string }>('select claim_invite_email($1, $2, $3) as c', [OWNER, inv, cap])).c;
    expect(await claim(INV_SAM)).toBe('claimed');
    expect(await claim(INV_SAM)).toBe('already_sent');
    expect(await claim(INV_OTHER, 1)).toBe('daily_limit');
    // Revoke the emailed invitation: its log row stays (no invitation id), so the count holds.
    await db.exec(`delete from invitations where id = '${INV_SAM}'`);
    expect(await one(`select invitation_id from invite_email_log`)).toEqual({ invitation_id: null });
    expect(await claim(INV_OTHER, 1)).toBe('daily_limit');
    expect(await claim(INV_OTHER, 2)).toBe('claimed');
    await expect(db.query('select claim_invite_email($1, $2, $3)', [OWNER, INV_EVE, -1])).rejects.toThrow(/invalid_cap/);
  });

  it('INV-010 · deleting an account removes invitations addressed to it, and no one else\'s', async () => {
    await db.query('select purge_account($1)', [SAM]);
    const left = await db.query<{ id: string }>('select id from invitations order by id');
    expect(left.rows.map(r => r.id)).toEqual([INV_OTHER, INV_EVE, INV_ACCEPTED, INV_LINK].sort());
  });
});
