import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// T4D-001..005 — v10.127.0 (Track T4d; owner decisions 19 Oct 2026: one device list). The Vyact Android app
// registers its phone with its FCM token as a `push_subscriptions` row of kind 'fcm', beside the browsers'
// 'webpush' rows: the same person-and-household rules, the same 10-device cap, its own status and unregister.
// Runs the real migrations (web push, T2b-2, then T4d) on PGlite.

const db = new PGlite();
const MIGRATIONS = ['20261003120000_web_push.sql', '20261101120000_t2b_server_notifications_push.sql', '20261108120000_t4d_native_push.sql'];

const ASHA = '10000000-0000-4000-8000-00000000000a';
const RAVI = '10000000-0000-4000-8000-00000000000b';
const DAN = '10000000-0000-4000-8000-00000000000d';    // not a member
const H = '20000000-0000-4000-8000-000000000001';
const H2 = '20000000-0000-4000-8000-000000000002';
const TOKEN = `dXyZ1234abcd:APA91b${'Q'.repeat(140)}`;
const P256DH = `B${'x'.repeat(86)}`;
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
    create table households (id uuid primary key, name text not null);
    create table memberships (household_id uuid not null, user_id uuid not null, role text not null);
    create function public.is_member(h uuid) returns boolean language sql stable security definer as
      $$ select exists (select 1 from memberships where household_id = h and user_id = auth.uid()) $$;
    create function public.role_in(h uuid) returns text language sql stable security definer as
      $$ select role from memberships where household_id = h and user_id = auth.uid() limit 1 $$;
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
  // The web-push migration's tables and device functions (its Vault keys and cron job are not needed here).
  const webPush = readFileSync(new URL(`../../../../supabase/migrations/${MIGRATIONS[0]}`, import.meta.url), 'utf8');
  const cut = webPush.indexOf('-- ── Service side');
  await db.exec(`${webPush.slice(0, cut).replace(/references auth\.users\(id\) on delete cascade/, '')}\ncommit;`);
  for (const m of MIGRATIONS.slice(1)) await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${m}`, import.meta.url), 'utf8'));
  await db.exec(`
    insert into households values ('${H}', 'Sharma family'), ('${H2}', 'Asha and Ravi');
    insert into memberships values ('${H}', '${ASHA}', 'owner'), ('${H}', '${RAVI}', 'member'), ('${H2}', '${ASHA}', 'owner');
  `);
}, 60000);
afterAll(async () => { await db.close(); });

async function asUser<T>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await db.query<T>(sql, params); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const registerPhone = (uid: string, token: string, hid = H, prefs: object = { master: true, lockScreenDetails: true }) =>
  asUser<{ r: { id: string } }>(uid, `select public.register_native_push($1, $2, 'Mozilla/5.0 (Linux; Android 14; wv)', 'Asia/Kolkata', $3::jsonb) as r`,
    [token, hid, JSON.stringify(prefs)]);
const registerBrowser = (uid: string, endpoint: string) =>
  asUser(uid, `select public.register_push_subscription($1, $2, $3, $4, 'Chrome', 'Asia/Kolkata', '{}'::jsonb)`, [endpoint, P256DH, AUTH, H]);
const row = async (token: string) => (await db.query<{
  id: string; kind: string; endpoint: string | null; p256dh: string | null; auth: string | null; user_id: string;
  household_id: string; prefs: Record<string, unknown>; created_at: string; disabled_at: string | null; failures: number;
}>(`select * from push_subscriptions where fcm_token = $1`, [token])).rows[0];
const live = async (uid: string) => (await db.query<{ kind: string; fcm_token: string | null; endpoint: string | null }>(
  `select kind, fcm_token, endpoint from push_subscriptions where user_id = $1 and disabled_at is null order by updated_at`, [uid])).rows;

describe('the Android app\'s phone is a device in the one list (T4d)', () => {
  it('T4D-001 · a member registers their phone by its FCM token; again updates it; a household switch starts it afresh', async () => {
    const first = await registerPhone(ASHA, TOKEN);
    const r = await row(TOKEN);
    expect(r).toMatchObject({ kind: 'fcm', endpoint: null, p256dh: null, auth: null, user_id: ASHA, household_id: H, failures: 0 });
    expect(r.prefs).toEqual({ master: true, lockScreenDetails: true });
    await db.exec(`update push_subscriptions set created_at = now() - interval '1 day', failures = 3, disabled_at = now() where fcm_token = '${TOKEN}'`);
    const before = (await row(TOKEN)).created_at;

    const again = await registerPhone(ASHA, TOKEN, H, { master: true, lockScreenDetails: false });
    expect(again.rows[0].r.id).toBe(first.rows[0].r.id);                 // the same device
    expect(await row(TOKEN)).toMatchObject({ failures: 0, disabled_at: null, prefs: { master: true, lockScreenDetails: false } });
    expect((await row(TOKEN)).created_at).toEqual(before);              // same person, same household: no reset

    await registerPhone(ASHA, TOKEN, H2);
    expect((await row(TOKEN)).household_id).toBe(H2);
    expect(new Date((await row(TOKEN)).created_at).getTime()).toBeGreaterThan(new Date(before).getTime());   // no backlog
    await registerPhone(ASHA, TOKEN, H);
  });

  it('T4D-002 · refused: signed out, not a member, a malformed token; the table holds a phone and a browser to their own shapes', async () => {
    await expect(db.query(`select public.register_native_push($1, $2)`, [TOKEN, H])).rejects.toThrow(/not_authenticated/);
    await expect(registerPhone(DAN, `${TOKEN}dan`)).rejects.toThrow(/not_a_member/);
    for (const bad of ['short', `${'a'.repeat(40)} drop`, `https://fcm.googleapis.com/fcm/send/${'a'.repeat(40)}`, 'a'.repeat(5000)]) {
      await expect(registerPhone(ASHA, bad), bad.slice(0, 20)).rejects.toThrow(/bad_token/);
    }
    await expect(db.query(`insert into push_subscriptions (user_id, household_id, kind, fcm_token, endpoint) values ($1, $2, 'fcm', 'x', 'https://e')`, [ASHA, H]))
      .rejects.toThrow(/ck_push_subscription_shape/);
    await expect(db.query(`insert into push_subscriptions (user_id, household_id, kind, endpoint) values ($1, $2, 'webpush', 'https://e')`, [ASHA, H]))
      .rejects.toThrow(/ck_push_subscription_shape/);
    await expect(db.query(`insert into push_subscriptions (user_id, household_id, kind, fcm_token) values ($1, $2, 'apns', 'x')`, [ASHA, H]))
      .rejects.toThrow(/push_subscriptions_kind_check|ck_push_subscription_shape/);   // no third kind
  });

  it('T4D-003 · browsers keep registering as before, and the 10-device cap counts browsers and phones together', async () => {
    await registerBrowser(RAVI, 'https://fcm.googleapis.com/fcm/send/ravi-0');
    expect((await db.query<{ kind: string; fcm_token: string | null }>(`select kind, fcm_token from push_subscriptions where endpoint like '%ravi-0'`)).rows[0])
      .toEqual({ kind: 'webpush', fcm_token: null });
    for (let i = 1; i <= 5; i++) await registerBrowser(RAVI, `https://fcm.googleapis.com/fcm/send/ravi-${i}`);
    for (let i = 1; i <= 5; i++) await registerPhone(RAVI, `${TOKEN}r${i}`);
    const devices = await live(RAVI);
    expect(devices).toHaveLength(10);
    expect(devices.map(d => d.endpoint ?? d.fcm_token)).not.toContain('https://fcm.googleapis.com/fcm/send/ravi-0');   // the oldest went
    expect(devices.filter(d => d.kind === 'fcm')).toHaveLength(5);
  });

  it('T4D-004 · status and unregister act on the caller\'s own phone only', async () => {
    const status = (uid: string, t: string) => asUser<{ s: Record<string, unknown> }>(uid, `select public.native_push_status($1) as s`, [t]);
    expect((await status(ASHA, TOKEN)).rows[0].s).toMatchObject({ registered: true, active: true, household_id: H });
    expect((await status(RAVI, TOKEN)).rows[0].s).toEqual({ registered: false });          // not Ravi's phone
    await asUser(RAVI, `select public.unregister_native_push($1)`, [TOKEN]);
    expect(await row(TOKEN)).toBeTruthy();                                                 // untouched
    await asUser(ASHA, `select public.unregister_native_push($1)`, [TOKEN]);
    expect(await row(TOKEN)).toBeUndefined();
    expect((await status(ASHA, TOKEN)).rows[0].s).toEqual({ registered: false });
  });

  it('T4D-005 · only signed-in people may call the phone functions; nobody reads the table directly', async () => {
    const grants = await db.query<{ routine_name: string; grantee: string }>(`
      select routine_name, grantee from information_schema.routine_privileges
       where routine_name in ('register_native_push', 'unregister_native_push', 'native_push_status') and privilege_type = 'EXECUTE'`);
    const by = (fn: string) => grants.rows.filter(g => g.routine_name === fn).map(g => g.grantee).sort();
    for (const fn of ['register_native_push', 'unregister_native_push', 'native_push_status']) {
      expect(by(fn), fn).toContain('authenticated');
      expect(by(fn), fn).not.toContain('anon');
      expect(by(fn), fn).not.toContain('PUBLIC');
    }
    await expect(asUser(ASHA, `select * from push_subscriptions`)).rejects.toThrow(/permission denied/);
  });
});
