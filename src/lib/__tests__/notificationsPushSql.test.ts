import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// T2B-003..008 — v10.116.0 (Track T2, part b-2; audit DB-SEC-06, BE-FN-07; owner decision 18 Oct 2026:
// "push only the server's"). A device writes bell cards, but only what the SERVER raised reaches a lock
// screen; a device can't write a row that looks like the server's, edit a card's words, or (as a viewer)
// create or delete one; the server takes over a device's card with the same key. Push devices are the real
// push services only, at most 10 a person.
// Runs the real migrations (web push, then T2b-2) over the notifications table and its policies as they
// stand on main (v10.1.0).

const db = new PGlite();
const MIGRATIONS = ['20261003120000_web_push.sql', '20261101120000_t2b_server_notifications_push.sql'];

const ASHA = '10000000-0000-4000-8000-00000000000a';    // owner of H
const RAVI = '10000000-0000-4000-8000-00000000000b';    // member of H
const VIK = '10000000-0000-4000-8000-00000000000c';     // viewer of H
const DAN = '10000000-0000-4000-8000-00000000000d';     // not a member
const H = '20000000-0000-4000-8000-000000000001';
const P256DH = `B${'x'.repeat(86)}`;                     // 87 chars, as a 65-byte key in base64url
const AUTH = 'a'.repeat(22);

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  await db.exec(`
    create table households (id uuid primary key, name text not null);
    create table memberships (household_id uuid not null, user_id uuid not null, role text not null);
    create function public.is_member(h uuid) returns boolean language sql stable security definer as
      $$ select exists (select 1 from memberships where household_id = h and user_id = auth.uid()) $$;
    create function public.role_in(h uuid) returns text language sql stable security definer as
      $$ select role from memberships where household_id = h and user_id = auth.uid() limit 1 $$;

    -- v10.1.0 (20260709120000), as it stands on main.
    create table notifications (
      id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade,
      type text not null, priority text not null default 'P2' check (priority in ('P1', 'P2')),
      title text not null, body text,
      status text not null default 'unread' check (status in ('unread', 'read', 'dismissed')),
      created_at timestamptz not null default now(), due_at timestamptz, member_id uuid, amount_ref numeric,
      deep_link text, tint text, actions jsonb, context jsonb, dedupe_key text not null);
    create unique index uq_notif_dedupe on notifications(household_id, dedupe_key);
    alter table notifications enable row level security;
    create policy "notif_read"   on notifications for select using (is_member(household_id));
    create policy "notif_insert" on notifications for insert with check (is_member(household_id));
    create policy "notif_update" on notifications for update using (is_member(household_id));
    create policy "notif_delete" on notifications for delete using (is_member(household_id));
    grant select, insert, update, delete on notifications to authenticated;
  `);
  // The web-push migration also schedules its cron job and Vault secret; only its tables and RPCs matter here.
  const webPush = readFileSync(new URL(`../../../../supabase/migrations/${MIGRATIONS[0]}`, import.meta.url), 'utf8');
  const cut = webPush.indexOf('create or replace function public.unregister_push_subscription');
  await db.exec(`${webPush.slice(0, cut).replace(/references auth\.users\(id\) on delete cascade/, '')}\ncommit;`);
  await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${MIGRATIONS[1]}`, import.meta.url), 'utf8'));
  await db.exec(`
    insert into households values ('${H}', 'Sharma family');
    insert into memberships values ('${H}', '${ASHA}', 'owner'), ('${H}', '${RAVI}', 'member'), ('${H}', '${VIK}', 'viewer');
  `);
}, 60000);
afterAll(async () => { await db.close(); });

/** As PostgREST runs a signed-in person's request: their id, the 'authenticated' claim and role. */
async function asUser<T>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false);
    select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${uid}"}', false); set role authenticated;`);
  try { return await db.query<T>(sql, params); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`); }
}
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0];
const count = async (sql: string) => (await one<{ n: number }>(`select count(*)::int as n from (${sql}) q`)).n;
const card = (key: string, extra: Record<string, unknown> = {}) => ({
  household_id: H, type: 'recurring_due', priority: 'P1', title: 'Rent due today', body: '₹25,000 to Landlord',
  status: 'unread', deep_link: '/recurring?id=r1', dedupe_key: key, ...extra,
});
const insertCard = (uid: string, c: Record<string, unknown>) => asUser(uid,
  `insert into notifications (household_id, type, priority, title, body, status, deep_link, dedupe_key${'source' in c ? ', source' : ''}${'pushed_at' in c ? ', pushed_at' : ''})
   values ($1, $2, $3, $4, $5, $6, $7, $8${'source' in c ? ', $9' : ''}${'pushed_at' in c ? `, $${'source' in c ? 10 : 9}` : ''})`,
  [c.household_id, c.type, c.priority, c.title, c.body, c.status, c.deep_link, c.dedupe_key,
    ...('source' in c ? [c.source] : []), ...('pushed_at' in c ? [c.pushed_at] : [])]);

describe('what a device may write (DB-SEC-06)', () => {
  it('T2B-003 · a member writes its own kind of card; a viewer, a "server" card, a pre-pushed card and a link out of Vyact are refused', async () => {
    await insertCard(RAVI, card('rent:2026-10-01'));
    expect(await one(`select source, pushed_at from notifications where dedupe_key = 'rent:2026-10-01'`)).toEqual({ source: 'client', pushed_at: null });
    for (const link of [null, '/', '/budgets?budgetId=b1', '/chat?ask=Why%20so%20high']) {
      await insertCard(RAVI, card(`ok:${link}`, { deep_link: link }));
    }
    const refused: [string, string, Record<string, unknown>][] = [
      ['viewer', VIK, card('v:1')],
      ['not a member', DAN, card('d:1')],
      ['server card', RAVI, card('s:1', { source: 'server' })],
      ['pre-pushed', RAVI, card('p:1', { pushed_at: new Date().toISOString() })],
      ['outside link', RAVI, card('l:1', { deep_link: 'https://evil.example/call-us' })],
      ['protocol-relative', RAVI, card('l:2', { deep_link: '//evil.example/x' })],
      ['backslash', RAVI, card('l:3', { deep_link: '/\\evil.example/x' })],
      ['script', RAVI, card('l:4', { deep_link: 'javascript:alert(1)' })],
    ];
    for (const [why, uid, c] of refused) {
      await expect(insertCard(uid, c), why).rejects.toThrow(/row-level security/);
    }
    expect(await count(`select 1 from notifications where dedupe_key in ('v:1','d:1','s:1','p:1','l:1','l:2','l:3','l:4')`)).toBe(0);
    // An unknown source is refused by the table itself, whoever writes it.
    await expect(db.exec(`insert into notifications (household_id, type, title, dedupe_key, source) values ('${H}', 't', 'x', 'k:x', 'meta')`))
      .rejects.toThrow(/notifications_source_check/);
  });

  it('T2B-004 · from the app only the read state changes — anyone in the household can mark read; nobody can reword, re-link or stamp a card', async () => {
    await asUser(VIK, `update notifications set status = 'read' where dedupe_key = 'rent:2026-10-01'`);
    expect((await one<{ status: string }>(`select status from notifications where dedupe_key = 'rent:2026-10-01'`)).status).toBe('read');
    for (const [col, val] of [['title', 'Security alert: call +1 555 0100'], ['body', 'Call us now'], ['deep_link', '/settings'],
      ['priority', 'P2'], ['source', 'server'], ['pushed_at', new Date().toISOString()], ['dedupe_key', 'other']] as const) {
      await expect(asUser(RAVI, `update notifications set ${col} = $1 where dedupe_key = 'rent:2026-10-01'`, [val]), col)
        .rejects.toThrow(/notification_fixed/);
    }
    expect(await one(`select title, source, pushed_at from notifications where dedupe_key = 'rent:2026-10-01'`))
      .toEqual({ title: 'Rent due today', source: 'client', pushed_at: null });
    // The web-push job (service role, no 'authenticated' claim) stamps pushed_at as before.
    await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
    await db.exec(`update notifications set pushed_at = now() where dedupe_key = 'ok:/'`);
    await db.exec(`select set_config('request.jwt.claims', '', false)`);
    expect((await one<{ pushed: boolean }>(`select pushed_at is not null as pushed from notifications where dedupe_key = 'ok:/'`)).pushed).toBe(true);
  });

  it('T2B-005 · a viewer cannot delete the household\'s cards; a member can', async () => {
    const r = await asUser(VIK, `delete from notifications where dedupe_key = 'ok:null'`);
    expect(r.affectedRows ?? 0).toBe(0);
    expect(await count(`select 1 from notifications where dedupe_key = 'ok:null'`)).toBe(1);
    await asUser(RAVI, `delete from notifications where dedupe_key = 'ok:null'`);
    expect(await count(`select 1 from notifications where dedupe_key = 'ok:null'`)).toBe(0);
  });
});

describe('the server raises, and takes over a device\'s card (DB-SEC-06)', () => {
  it('T2B-006 · raise_server_notifications takes over a device card with the same key (its words, kept read state), adds new ones, never touches its own', async () => {
    await insertCard(RAVI, card('bill:2026-10-05', { title: 'Fake: call +1 555 0100', deep_link: '/' }));
    await asUser(RAVI, `update notifications set status = 'read' where dedupe_key = 'bill:2026-10-05'`);
    const rows = [
      card('bill:2026-10-05', { title: 'Electricity due today', body: '₹1,800 to BESCOM', deep_link: '/recurring?id=r2', created_at: '2000-01-01' }),
      card('budget:groceries:80', { type: 'budget_threshold', title: 'Groceries at 85% of the October budget', deep_link: '/budgets?budgetId=b1' }),
    ];
    const first = await one<{ n: number }>(`select raise_server_notifications('${JSON.stringify(rows)}'::jsonb) as n`);
    expect(first.n).toBe(2);
    expect(await one(`select title, body, deep_link, source, status from notifications where dedupe_key = 'bill:2026-10-05'`))
      .toEqual({ title: 'Electricity due today', body: '₹1,800 to BESCOM', deep_link: '/recurring?id=r2', source: 'server', status: 'read' });
    expect(await one(`select source, status from notifications where dedupe_key = 'budget:groceries:80'`)).toEqual({ source: 'server', status: 'unread' });
    // The time a card was raised is the database's, never the sender's (a stale one would fall outside the push window).
    expect(await count(`select 1 from notifications where source = 'server' and created_at < now() - interval '1 day'`)).toBe(0);
    // Raised again (another run, another wording): the server's own row is left as it is.
    const again = await one<{ n: number }>(`select raise_server_notifications('${JSON.stringify([{ ...rows[1], title: 'changed' }])}'::jsonb) as n`);
    expect(again.n).toBe(0);
    expect((await one<{ title: string }>(`select title from notifications where dedupe_key = 'budget:groceries:80'`)).title)
      .toBe('Groceries at 85% of the October budget');
    // Only the service role may raise.
    await expect(asUser(ASHA, `select raise_server_notifications('[]'::jsonb)`)).rejects.toThrow(/permission denied/);
    expect(await one(`select has_function_privilege('service_role', 'raise_server_notifications(jsonb)', 'execute') as ok`)).toEqual({ ok: true });
    // A device's later copy of a server card changes nothing (the app's upsert ignores duplicates).
    await asUser(RAVI, `insert into notifications (household_id, type, title, dedupe_key) values ($1, 't', 'copy', 'budget:groceries:80') on conflict do nothing`, [H]);
    expect(await one(`select title, source from notifications where dedupe_key = 'budget:groceries:80'`))
      .toEqual({ title: 'Groceries at 85% of the October budget', source: 'server' });
  });
});

describe('push devices (BE-FN-07)', () => {
  const register = (uid: string, endpoint: string) => asUser<{ r: { id: string } }>(uid,
    `select register_push_subscription($1, $2, $3, $4) as r`, [endpoint, P256DH, AUTH, H]);

  it('T2B-007 · only the real push services: Apple\'s web push host and Windows\' WNS hosts, not any *.push.apple.com or *.notify.windows.com', async () => {
    for (const ok of ['https://web.push.apple.com/QK1', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://fcm.googleapis.com/fcm/send/a1',
      'https://updates.push.services.mozilla.com/wpush/v2/x']) {
      await register(RAVI, ok);
    }
    for (const bad of ['https://api.push.apple.com/x', 'https://nx-0000.notify.windows.com/w/x', 'https://evil.example/fcm.googleapis.com/',
      'http://fcm.googleapis.com/fcm/send/x']) {
      await expect(register(RAVI, bad), bad).rejects.toThrow(/bad_endpoint/);
    }
  });

  it('T2B-008 · at most 10 live devices a person: an 11th retires the oldest; refreshing one retires nothing; others are untouched', async () => {
    await db.exec(`delete from push_subscriptions`);
    await db.exec(`insert into push_subscriptions (user_id, household_id, endpoint, p256dh, auth, updated_at, created_at)
      select '${ASHA}', '${H}', 'https://fcm.googleapis.com/fcm/send/asha-' || i, '${P256DH}', '${AUTH}',
             now() - (i || ' hours')::interval, now() - (i || ' hours')::interval from generate_series(1, 10) i`);
    await db.exec(`insert into push_subscriptions (user_id, household_id, endpoint, p256dh, auth)
      select '${RAVI}', '${H}', 'https://fcm.googleapis.com/fcm/send/ravi-' || i, '${P256DH}', '${AUTH}' from generate_series(1, 10) i`);
    const live = (uid: string) => count(`select 1 from push_subscriptions where user_id = '${uid}' and disabled_at is null`);

    // Refreshing a device already registered keeps all ten.
    await register(ASHA, 'https://fcm.googleapis.com/fcm/send/asha-3');
    expect(await live(ASHA)).toBe(10);
    // An 11th: the least recently used (asha-10) is retired, the new one is live.
    await register(ASHA, 'https://fcm.googleapis.com/fcm/send/asha-new');
    expect(await live(ASHA)).toBe(10);
    expect((await db.query<{ endpoint: string }>(`select endpoint from push_subscriptions where user_id = '${ASHA}' and disabled_at is not null`)).rows)
      .toEqual([{ endpoint: 'https://fcm.googleapis.com/fcm/send/asha-10' }]);
    expect(await count(`select 1 from push_subscriptions where endpoint like '%asha-new' and disabled_at is null`)).toBe(1);
    // Another person's devices are not counted against her.
    expect(await live(RAVI)).toBe(10);
    // A retired device that comes back is live again, and the oldest other one makes room.
    await register(ASHA, 'https://fcm.googleapis.com/fcm/send/asha-10');
    expect(await live(ASHA)).toBe(10);
    expect((await db.query<{ endpoint: string }>(`select endpoint from push_subscriptions where user_id = '${ASHA}' and disabled_at is not null`)).rows)
      .toEqual([{ endpoint: 'https://fcm.googleapis.com/fcm/send/asha-9' }]);
  });
});
