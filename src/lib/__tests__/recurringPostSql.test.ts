import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// W4a (v10.70.0; owner decision D16) — post_recurring_occurrence: the server posts ONE due occurrence
// of an auto-approved bill and moves the schedule on, in one transaction, re-checking the schedule
// on the database's own copy (live, active, auto, the pointer, due in the household's zone).

const db = new PGlite();
const HH = '20000000-0000-4000-8000-0000000000e1';
const ACC = '40000000-0000-4000-8000-0000000000e1';
const SID = '30000000-0000-4000-8000-0000000000e1';
const TXN = '50000000-0000-4000-8000-0000000000e1';
let today = '';
let tomorrow = '';
let yesterday = '';

const template = (extra: Record<string, unknown> = {}) => JSON.stringify({
  type: 'expense', amount: 500, currency: 'INR', description: 'Rent', category: 'rent_mortgage', accountId: ACC, ...extra,
});
const row = (date: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  id: TXN, household_id: HH, recurring_schedule_id: SID, date, type: 'expense', amount: 500, currency: 'INR',
  description: 'Rent', category: 'rent_mortgage', account_id: ACC, recurring: 'monthly', extras: {}, ...extra,
});
async function post(args: { occurrence: string; post?: boolean; row?: string | null; next?: string | null; last?: string; exhausted?: boolean }) {
  const r = await db.query<{ r: Record<string, unknown> }>(
    `select post_recurring_occurrence($1::uuid, $2::date, $3, $4::jsonb, $5::date, $6::date, $7) as r`,
    [SID, args.occurrence, args.post ?? true, args.row === undefined ? row(args.occurrence) : args.row,
     args.next === undefined ? '2099-01-01' : args.next, args.last ?? args.occurrence, args.exhausted ?? false]);
  return r.rows[0].r;
}
const schedule = async () => (await db.query<{ next_due_date: string; last_generated: string | null; active: boolean }>(
  `select next_due_date::text, last_generated::text, active from recurring_schedules where id = '${SID}'`)).rows[0];
const txnCount = async () => (await db.query<{ n: number }>(`select count(*)::int as n from transactions`)).rows[0].n;

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table households (id uuid primary key, timezone text not null default 'Asia/Kolkata');
    create table accounts (id uuid primary key, payment_modes text[]);
    create table recurring_schedules (
      id uuid primary key, household_id uuid not null, created_by uuid, txn_template jsonb not null default '{}',
      frequency text not null, start_date date not null, next_due_date date not null, last_generated date,
      auto_confirm boolean not null default false, active boolean not null default true, deleted_at timestamptz);
    create table transactions (
      id uuid primary key, household_id uuid, created_by uuid, member_id uuid, type text, amount numeric, currency text,
      date date, description text, category text, note text, recurring text, account_id uuid, to_account_id uuid,
      asset_id uuid, initiated_by uuid, recurring_schedule_id uuid, debt_id uuid, payment_mode text, extras jsonb,
      confidence text, source text, estimated_at timestamptz, confirmed_at timestamptz,
      constraint ck_txn_accounts_by_type check (type <> 'expense' or account_id is not null));
    insert into households values ('${HH}', 'Asia/Kolkata');
    insert into accounts values ('${ACC}', array['upi']);
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261015120000_w4a_server_posts_recurring.sql', import.meta.url), 'utf8'));
  const d = (await db.query<{ t: string; m: string; p: string }>(`select (now() at time zone 'Asia/Kolkata')::date::text as t,
    ((now() at time zone 'Asia/Kolkata')::date + 1)::text as p, ((now() at time zone 'Asia/Kolkata')::date - 1)::text as m`)).rows[0];
  today = d.t; tomorrow = d.p; yesterday = d.m;
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`delete from transactions; delete from recurring_schedules;
    update households set timezone = 'Asia/Kolkata';
    insert into recurring_schedules (id, household_id, txn_template, frequency, start_date, next_due_date, auto_confirm)
    values ('${SID}', '${HH}', '${template()}', 'monthly', '2026-01-01', '${yesterday}', true);`);
});

describe('post_recurring_occurrence (W4a)', () => {
  it('W4-D16-001 · posts the due occurrence as the app’s row and moves the schedule on, once', async () => {
    expect(await post({ occurrence: yesterday, next: tomorrow, row: row(yesterday, { payment_mode: 'card' }) }))
      .toMatchObject({ status: 'posted', already_posted: false, next_due_date: tomorrow, finished: false });
    expect(await schedule()).toEqual({ next_due_date: tomorrow, last_generated: yesterday, active: true });
    const t = (await db.query<{ id: string; date: string; amount: string; payment_mode: string | null; recurring_schedule_id: string }>(
      `select id, date::text, amount::text, payment_mode, recurring_schedule_id from transactions`)).rows;
    // The mode the paying account does not use is dropped, never an error.
    expect(t).toEqual([{ id: TXN, date: yesterday, amount: '500', payment_mode: null, recurring_schedule_id: SID }]);

    // A second run on the same pointer finds it moved; a replay of the row adds nothing.
    expect(await post({ occurrence: yesterday, next: tomorrow })).toMatchObject({ status: 'skipped', reason: 'moved' });
    await db.exec(`update recurring_schedules set next_due_date = '${yesterday}' where id = '${SID}'`);
    expect(await post({ occurrence: yesterday, next: tomorrow })).toMatchObject({ status: 'posted', already_posted: true });
    expect(await txnCount()).toBe(1);
  });

  it('W4-D16-002 · re-checks its own copy: paused, approval-gated, deleted, loan EMI, not yet due in the household’s zone, wrong row', async () => {
    await db.exec(`update recurring_schedules set active = false`);
    expect(await post({ occurrence: yesterday })).toMatchObject({ status: 'skipped', reason: 'not_auto' });
    await db.exec(`update recurring_schedules set active = true, auto_confirm = false`);
    expect(await post({ occurrence: yesterday })).toMatchObject({ status: 'skipped', reason: 'not_auto' });
    await db.exec(`update recurring_schedules set auto_confirm = true, deleted_at = now()`);
    expect(await post({ occurrence: yesterday })).toMatchObject({ status: 'skipped', reason: 'schedule_unavailable' });
    await db.exec(`update recurring_schedules set deleted_at = null, txn_template = '${template({ category: 'loan_emi' })}'`);
    expect(await post({ occurrence: yesterday })).toMatchObject({ status: 'skipped', reason: 'posted_in_app' });
    await db.exec(`update recurring_schedules set txn_template = '${template()}', next_due_date = '${tomorrow}'`);
    expect(await post({ occurrence: tomorrow })).toMatchObject({ status: 'skipped', reason: 'not_due_yet' });
    // Tomorrow in India can already be today further east: the household's zone decides.
    await db.exec(`update households set timezone = 'Pacific/Kiritimati'`);
    const east = (await db.query<{ d: string }>(`select (now() at time zone 'Pacific/Kiritimati')::date::text as d`)).rows[0].d;
    await db.exec(`update recurring_schedules set next_due_date = '${east}'`);
    expect((await post({ occurrence: east, next: '2099-01-01' })).status).toBe('posted');
    await db.exec(`delete from transactions; update households set timezone = 'Asia/Kolkata';
      update recurring_schedules set next_due_date = '${yesterday}', active = true`);
    expect(await post({ occurrence: yesterday, row: row(yesterday, { amount: 501 }) })).toMatchObject({ status: 'error', reason: 'row_mismatch' });
    expect(await post({ occurrence: yesterday, next: yesterday })).toMatchObject({ status: 'error', reason: 'bad_next_due' });
    expect(await txnCount()).toBe(0);
    expect((await schedule()).next_due_date).toBe(yesterday);
  });

  it('W4-D16-003 · the last occurrence closes the schedule; a stale pointer moves on without posting; a refused row leaves it due', async () => {
    expect(await post({ occurrence: yesterday, next: null, exhausted: true })).toMatchObject({ status: 'posted', next_due_date: null, finished: true });
    expect(await schedule()).toEqual({ next_due_date: yesterday, last_generated: yesterday, active: false });

    await db.exec(`delete from transactions; update recurring_schedules set active = true, last_generated = null, next_due_date = '2026-01-01'`);
    expect(await post({ occurrence: '2026-01-01', post: false, row: null, next: tomorrow, last: yesterday }))
      .toMatchObject({ status: 'fast_forwarded', next_due_date: tomorrow });
    expect(await schedule()).toEqual({ next_due_date: tomorrow, last_generated: yesterday, active: true });
    expect(await txnCount()).toBe(0);

    await db.exec(`update recurring_schedules set next_due_date = '${yesterday}'`);
    expect(await post({ occurrence: yesterday, row: row(yesterday, { account_id: null }) }))
      .toMatchObject({ status: 'error', reason: 'row_rejected' });
    expect((await schedule()).next_due_date).toBe(yesterday);
    expect(await txnCount()).toBe(0);
    expect(today > yesterday).toBe(true);
  });
});
