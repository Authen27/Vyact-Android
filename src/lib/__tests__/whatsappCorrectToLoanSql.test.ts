import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 13 Oct 2026 (BE-WA-08, INT-TXN-07; owner decision) — "no, that was car emi" on WhatsApp turns the entry
// WhatsApp just logged into a payment on the loan: loan_payment_core's split, the plain expense removed,
// in one transaction, never twice. The real W3 correction helpers and the real W4e loan model are loaded.

const db = new PGlite();
const OWNER = '10000000-0000-4000-8000-0000000000c1';
const VIEWER = '10000000-0000-4000-8000-0000000000c2';
const HH = '20000000-0000-4000-8000-0000000000c1';
const BANK = '40000000-0000-4000-8000-0000000000c1';
const CAR = '30000000-0000-4000-8000-0000000000c1';
const MIGRATIONS = new URL('../../../../supabase/migrations/', import.meta.url);
const sql = (file: string) => readFileSync(new URL(file, MIGRATIONS), 'utf8');
let today = '';

const query = async <T>(q: string, p: unknown[] = []) => (await db.query<T>(q, p)).rows;
let seq = 0;
/** An expense WhatsApp logged for the owner, `minutesAgo` before now; returns its id. */
async function logged(amount: number, minutesAgo = 1): Promise<string> {
  const id = (await query<{ id: string }>(
    `insert into transactions (household_id, created_by, amount, currency, type, category, account_id, date, description, created_at, updated_at)
     values ($1, $2, $3, 'INR', 'expense', 'other_expense', $4, $5::date, 'car', now() - make_interval(mins => $6), now() - make_interval(mins => $6))
     returning id`, [HH, OWNER, amount, BANK, today, minutesAgo]))[0].id;
  await db.query(`insert into whatsapp_inbound_messages (wa_message_id, profile_id, household_id, direction, processed_at, payload)
    values ($1, $2, $3, 'inbound', now() - make_interval(mins => $5), jsonb_build_object('parsed', jsonb_build_object('transaction_id', $4::text, 'type', 'expense')))`,
    [`wamid.log${++seq}`, OWNER, HH, id, minutesAgo]);
  return id;
}
const correct = async (msg: string, profile = OWNER, debt = CAR) => (await query<{ r: Record<string, unknown> }>(
  `select whatsapp_correct_to_loan($1, $2, $3, $4) as r`, [profile, HH, debt, msg]))[0].r;
const entry = async (id: string) => (await query<{ deleted: boolean; category: string }>(
  `select deleted_at is not null as deleted, category from transactions where id = $1`, [id]))[0];
const loanLegs = async () => query<{ type: string; amount: number; account_id: string; date: string }>(
  `select type, amount::float8 as amount, account_id, date::text from transactions where debt_id = $1 and deleted_at is null order by type`, [CAR]);

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${OWNER}'), ('${VIEWER}');
    create table profiles (id uuid primary key);
    insert into profiles values ('${OWNER}'), ('${VIEWER}');
    create table households (id uuid primary key, base_currency text not null default 'INR', timezone text);
    create table memberships (id uuid primary key default gen_random_uuid(), household_id uuid, user_id uuid, role text,
      joined_at timestamptz not null default now());
    create function is_member(hid uuid) returns boolean language sql as
      $$ select exists(select 1 from memberships where household_id = hid and user_id = auth.uid()) $$;
    create table accounts (id uuid primary key default gen_random_uuid(), household_id uuid, kind text, name text, currency text,
      opening_balance numeric not null default 0, reconciliation_offset numeric, reconciliation_log jsonb, last_reconciled_at timestamptz,
      is_archived boolean not null default false, is_default boolean not null default false, debt_id uuid,
      payment_modes text[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz, deleted_at timestamptz);
    create table debts (id uuid primary key default gen_random_uuid(), household_id uuid, type text not null, name text not null,
      principal numeric, current_balance numeric not null check (current_balance >= 0), interest_rate numeric not null,
      minimum_payment numeric not null, due_date date, currency text default 'INR', direction text default 'owed_by_me', extras jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz, deleted_at timestamptz);
    create table transactions (id uuid primary key default gen_random_uuid(), household_id uuid, created_by uuid, member_id uuid,
      amount numeric check (amount > 0), currency text, type text, category text, account_id uuid, to_account_id uuid, debt_id uuid,
      date date, description text, extras jsonb, created_at timestamptz not null default now(), updated_at timestamptz default now(),
      deleted_at timestamptz);
    create table loan_payment_events (operation_id uuid primary key, household_id uuid not null, debt_id uuid not null,
      expense_txn_id uuid, transfer_txn_id uuid, loan_account_id uuid, amount numeric not null, interest numeric not null,
      principal numeric not null, created_at timestamptz not null default now(), request jsonb);
    create table whatsapp_inbound_messages (wa_message_id text primary key, profile_id uuid, household_id uuid, direction text,
      processed_at timestamptz, payload jsonb);
    insert into households values ('${HH}', 'INR', 'Asia/Kolkata');
    insert into memberships (household_id, user_id, role) values ('${HH}', '${OWNER}', 'owner'), ('${HH}', '${VIEWER}', 'viewer');
    insert into accounts (id, household_id, kind, name, currency, is_default) values ('${BANK}', '${HH}', 'bank', 'HDFC', 'INR', true);
  `);
  await db.exec(sql('20261016120000_w4e_loan_model.sql'));
  today = (await query<{ t: string }>(`select (now() at time zone 'Asia/Kolkata')::date::text as t`))[0].t;
  await db.exec(`insert into debts (id, household_id, type, name, principal, current_balance, interest_rate, minimum_payment, due_date)
    values ('${CAR}', '${HH}', 'auto_loan', 'Car loan', 100000, 100000, 12, 8884.88, '${today}');`);
  await db.exec(sql('20260928120000_w3_whatsapp_capture_conversation.sql'));
  // W4 (20260929120000) replaced W3's inline kind CHECK with a named one, which this release extends.
  await db.exec(`alter table whatsapp_pending_turns drop constraint whatsapp_pending_turns_kind_check;`);
  await db.exec(sql('20261019120000_whatsapp_correct_to_loan.sql'));
}, 60000);
afterAll(async () => { await db.close(); });

describe.sequential('WhatsApp "that was loan emi" (13 Oct 2026)', () => {
  it('WA-EMI-001 · a refusal changes nothing: more than the instalment due leaves the entry as it was', async () => {
    const id = await logged(20000);
    expect(await correct('wamid.c1')).toMatchObject({ status: 'refused', reason: 'more_than_due', figure: '8884.88', loan: 'Car loan' });
    expect(await entry(id)).toEqual({ deleted: false, category: 'other_expense' });
    expect(await loanLegs()).toEqual([]);
    // Clear it away for the next case (UNDO, as the person would).
    await query(`select whatsapp_undo_last($1, $2, 'wamid.u1')`, [OWNER, HH]);
  });

  it('WA-EMI-002 · the entry becomes the loan payment — the server’s split, its account and date — and the expense goes', async () => {
    const id = await logged(8884.88);
    const r = await correct('wamid.c2');
    expect(r).toMatchObject({ status: 'success', interest: 1000, principal: 7884.88, instalment_no: 1, loan: 'Car loan', amount: 8884.88 });
    expect(await entry(id)).toMatchObject({ deleted: true });
    expect(await loanLegs()).toEqual([
      { type: 'expense', amount: 1000, account_id: BANK, date: today },
      { type: 'transfer', amount: 7884.88, account_id: BANK, date: today },
    ]);
    const owed = (await query<{ o: number }>(`select loan_outstanding(d)::float8 as o from debts d where id = $1`, [CAR]))[0].o;
    expect(owed).toBe(92115.12);
    const inbox = (await query<{ p: Record<string, unknown> }>(
      `select payload as p from whatsapp_inbound_messages where payload->'parsed'->>'transaction_id' = $1`, [id]))[0].p;
    expect(inbox).toHaveProperty('undone');
    expect(inbox).toHaveProperty('converted_to_loan');
  });

  it('WA-EMI-003 · never twice: a replay is a duplicate, and a second correction finds nothing to change', async () => {
    expect(await correct('wamid.c2')).toEqual({ status: 'duplicate' });
    expect(await correct('wamid.c3')).toEqual({ status: 'nothing' });
    expect(await loanLegs()).toHaveLength(2);
  });

  it('WA-EMI-004 · only within 15 minutes, and only for someone who may write', async () => {
    const late = await logged(5000, 20);
    expect(await correct('wamid.c4')).toEqual({ status: 'too_late' });
    expect(await entry(late)).toMatchObject({ deleted: false });
    expect(await correct('wamid.c5', VIEWER)).toEqual({ status: 'read_only_member' });
  });

  it('WA-EMI-005 · a plain correction never relabels an expense as Loan / EMI; other categories still change', async () => {
    const id = await logged(300);
    const emi = (await query<{ r: Record<string, unknown> }>(
      `select whatsapp_correct_last($1, $2, 'loan_emi', 'wamid.c6') as r`, [OWNER, HH]))[0].r;
    expect(emi).toEqual({ status: 'use_loan_payment' });
    expect(await entry(id)).toEqual({ deleted: false, category: 'other_expense' });
    const groceries = (await query<{ r: Record<string, unknown> }>(
      `select whatsapp_correct_last($1, $2, 'groceries', 'wamid.c7') as r`, [OWNER, HH]))[0].r;
    expect(groceries).toMatchObject({ status: 'corrected', category_id: 'groceries' });
  });

  it('WA-EMI-006 · "Which loan?" is a question kind the table accepts', async () => {
    await db.query(`insert into whatsapp_pending_turns (profile_id, household_id, kind, payload) values ($1, $2, 'emi_loan_choice', '{}')`, [OWNER, HH]);
    await expect(db.query(`insert into whatsapp_pending_turns (profile_id, household_id, kind) values ($1, $2, 'bogus')`, [VIEWER, HH]))
      .rejects.toThrow(/ck_wa_pending_kind/);
  });
});
