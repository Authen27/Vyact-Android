import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// W3d (v10.68.0; owner decision D13) — the recurrence schema ahead of the one-engine app: 'daily'
// is allowed, each schedule carries its month-end rule and an RRULE derived from its own columns,
// and approving the last occurrence over WhatsApp closes the schedule.

const db = new PGlite();
const HH = '20000000-0000-4000-8000-0000000000d1';
const ME = '10000000-0000-4000-8000-0000000000d1';

const schedule = (id: string, frequency: string, extra = '') => db.exec(`
  insert into recurring_schedules (id, household_id, txn_template, frequency, start_date, next_due_date ${extra ? ', ' + extra.split('=')[0] : ''})
  values ('${id}', '${HH}', '{"type":"expense","amount":500,"currency":"INR","description":"Rent","category":"rent_mortgage"}',
          '${frequency}', '2026-06-05', '2026-10-20' ${extra ? ', ' + extra.split('=').slice(1).join('=') : ''})`);
const rruleOf = async (id: string) => (await db.query<{ rrule: string }>(`select rrule from recurring_schedules where id = '${id}'`)).rows[0].rrule;
const approve = (id: string, extra = '') => db.query<{ r: Record<string, unknown> }>(`
  select whatsapp_approve_recurring(p_profile_id => '${ME}', p_household_id => '${HH}', p_schedule_id => '${id}',
    p_occurrence => '2026-10-20', p_today => '2026-10-20', p_next_due => '2026-11-20',
    p_row => jsonb_build_object('id', gen_random_uuid(), 'recurring_schedule_id', '${id}', 'household_id', '${HH}',
      'date', '2026-10-20', 'type', 'expense', 'amount', 500, 'currency', 'INR', 'description', 'Rent', 'category', 'rent_mortgage'),
    p_wa_message_id => gen_random_uuid()::text ${extra}) as r`);

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table households (id uuid primary key);
    create table memberships (id uuid primary key default gen_random_uuid(), household_id uuid, user_id uuid, role text);
    create table accounts (id uuid primary key default gen_random_uuid(), payment_modes text[]);
    create table whatsapp_inbound_messages (wa_message_id text primary key, profile_id uuid, household_id uuid,
      direction text, processed_at timestamptz, payload jsonb);
    create table recurring_schedules (
      id uuid primary key default gen_random_uuid(), household_id uuid not null, created_by uuid,
      txn_template jsonb not null default '{}',
      frequency text not null check (frequency in ('weekly','monthly','yearly','custom_day')),
      day_of_month int, weekday int, start_date date not null, next_due_date date not null, last_generated date,
      auto_confirm boolean not null default false, active boolean not null default true, reminder_lead_days int,
      rrule text, owner_member_id uuid, updated_at timestamptz default now(), deleted_at timestamptz);
    create table transactions (
      id uuid primary key, household_id uuid, created_by uuid, member_id uuid, type text, amount numeric, currency text,
      date date, description text, category text, note text,
      recurring text check (recurring in ('','weekly','monthly','yearly')),
      account_id uuid, to_account_id uuid, initiated_by uuid, recurring_schedule_id uuid, debt_id uuid, payment_mode text,
      extras jsonb, confidence text, source text, estimated_at timestamptz, confirmed_at timestamptz);
    insert into households values ('${HH}');
    insert into memberships (household_id, user_id, role) values ('${HH}', '${ME}', 'owner');
  `);
  // Rows as production has them before the migration: no rule, or the generic v9.1 one.
  await schedule('30000000-0000-4000-8000-000000000001', 'monthly', "day_of_month=20");
  await schedule('30000000-0000-4000-8000-000000000002', 'weekly', 'weekday=1');
  await schedule('30000000-0000-4000-8000-000000000003', 'yearly');
  await schedule('30000000-0000-4000-8000-000000000004', 'custom_day', 'day_of_month=31');
  await db.exec(`update recurring_schedules set rrule = 'FREQ=MONTHLY;INTERVAL=1' where id = '30000000-0000-4000-8000-000000000001';
    insert into recurring_schedules (id, household_id, frequency, start_date, next_due_date, rrule)
    values ('30000000-0000-4000-8000-000000000005', '${HH}', 'monthly', '2026-06-05', '2026-10-09',
            'FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=2');`);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261014120000_w3d_recurrence_schema.sql', import.meta.url), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`delete from transactions; update recurring_schedules set active = true, last_generated = null, next_due_date = '2026-10-20'
    where id in ('30000000-0000-4000-8000-000000000001');`);
});

describe('recurrence schema (W3d)', () => {
  it('CON-UNIT-W3-D13-001 · daily is allowed on schedules and entries; the month-end rule defaults to last_day and is checked', async () => {
    await schedule('30000000-0000-4000-8000-0000000000aa', 'daily');
    await db.exec(`insert into transactions (id, recurring) values (gen_random_uuid(), 'daily')`);
    await expect(schedule('30000000-0000-4000-8000-0000000000ab', 'hourly')).rejects.toThrow(/ck_recurring_frequency/);
    await expect(db.exec(`insert into transactions (id, recurring) values (gen_random_uuid(), 'hourly')`)).rejects.toThrow(/ck_txn_recurring/);
    const p = await db.query<{ short_month_policy: string }>(`select short_month_policy from recurring_schedules where id = '30000000-0000-4000-8000-0000000000aa'`);
    expect(p.rows[0].short_month_policy).toBe('last_day');
    await expect(db.exec(`update recurring_schedules set short_month_policy = 'skip' where id = '30000000-0000-4000-8000-0000000000aa'`))
      .rejects.toThrow(/ck_recurring_short_month_policy/);
  });

  it('CON-UNIT-W3-D13-002 · every schedule gets an RRULE from its own columns; a real rule is kept; older apps saving none get one', async () => {
    expect(await rruleOf('30000000-0000-4000-8000-000000000001')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=20');   // the 20th, not the creation day
    expect(await rruleOf('30000000-0000-4000-8000-000000000002')).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO');
    expect(await rruleOf('30000000-0000-4000-8000-000000000003')).toBe('FREQ=YEARLY;INTERVAL=1;BYMONTH=6;BYMONTHDAY=5');
    expect(await rruleOf('30000000-0000-4000-8000-000000000004')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31');
    expect(await rruleOf('30000000-0000-4000-8000-000000000005')).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=2');
    await db.exec(`update recurring_schedules set rrule = null, frequency = 'weekly', weekday = 3 where id = '30000000-0000-4000-8000-000000000002'`);
    expect(await rruleOf('30000000-0000-4000-8000-000000000002')).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=WE');
  });

  it('CON-UNIT-W3-D13-003 · approving over WhatsApp still advances; approving the LAST occurrence closes the schedule', async () => {
    const id = '30000000-0000-4000-8000-000000000001';
    const advanced = await approve(id);                                       // the old 8-argument call
    expect(advanced.rows[0].r).toMatchObject({ status: 'success', next_due_date: '2026-11-20', finished: false });
    let s = (await db.query<{ active: boolean; next_due_date: string; last_generated: string }>(
      `select active, next_due_date::text, last_generated::text from recurring_schedules where id = '${id}'`)).rows[0];
    expect(s).toEqual({ active: true, next_due_date: '2026-11-20', last_generated: '2026-10-20' });

    await db.exec(`delete from transactions; update recurring_schedules set next_due_date = '2026-10-20', last_generated = null where id = '${id}'`);
    const last = await approve(id, ", p_exhausted => true");
    expect(last.rows[0].r).toMatchObject({ status: 'success', next_due_date: null, finished: true });
    s = (await db.query<{ active: boolean; next_due_date: string; last_generated: string }>(
      `select active, next_due_date::text, last_generated::text from recurring_schedules where id = '${id}'`)).rows[0];
    expect(s).toEqual({ active: false, next_due_date: '2026-10-20', last_generated: '2026-10-20' });
    expect((await db.query(`select 1 from transactions where recurring_schedule_id = '${id}'`)).rows).toHaveLength(1);
  });
});
