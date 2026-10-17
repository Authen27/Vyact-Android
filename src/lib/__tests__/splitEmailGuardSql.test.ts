import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// W1c (audit 2026-10-04 BE-FN-06 / INT-HH-11 / XC-PRV-13) — split email is claimed before it is
// sent: one email per share per event, ever, and a daily cap per sender. Shares that existed
// before the migration count as already mailed, so old splits are not re-mailed after release.

const db = new PGlite();
const OWNER = '10000000-0000-4000-8000-0000000000c1';
const FRIEND = '10000000-0000-4000-8000-0000000000c2';
const OLD = '30000000-0000-4000-8000-0000000000d1';      // legacy open split, one share paid
const OLD_CLOSED = '30000000-0000-4000-8000-0000000000d2';
const NEW = '30000000-0000-4000-8000-0000000000d3';

type Claim = { claimed: string[]; limited: number };
const claim = async (split: string, event: string, ids: string[], cap: number | null = 50, sender = OWNER): Promise<Claim> => {
  const r = await db.query<{ c: Claim }>(
    'select public.claim_split_emails($1, $2, $3, $4::uuid[], $5) as c', [sender, split, event, ids, cap]);
  return r.rows[0].c;
};
const shareIds = async (split: string) =>
  (await db.query<{ id: string }>('select id from shared_split_shares where split_id = $1 order by created_at, id', [split])).rows.map(r => r.id);

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    grant usage on schema public to authenticated;
    create table shared_splits (id uuid primary key default gen_random_uuid(),
      owner_user_id uuid not null references auth.users(id) on delete cascade,
      description text not null default 'Dinner', currency text not null,
      total_amount numeric not null default 100, date date not null default current_date,
      closed_at timestamptz, created_at timestamptz not null default now());
    create table shared_split_shares (id uuid primary key default gen_random_uuid(),
      split_id uuid not null references shared_splits(id) on delete cascade,
      email text not null, share numeric not null default 10, paid boolean not null default false,
      paid_at timestamptz, settled_user_id uuid references auth.users(id),
      created_at timestamptz not null default now());
    insert into auth.users values ('${OWNER}', 'owner@example.com'), ('${FRIEND}', 'friend@example.com');
    -- Legacy rows, ten days old, written before the guard existed.
    insert into shared_splits (id, owner_user_id, currency, closed_at, created_at) values
      ('${OLD}', '${OWNER}', ' inr', null, now() - interval '10 days'),
      ('${OLD_CLOSED}', '${OWNER}', 'INR', now() - interval '9 days', now() - interval '10 days');
    insert into shared_split_shares (split_id, email, paid, paid_at, settled_user_id, created_at) values
      ('${OLD}', 'friend@example.com', true, now() - interval '8 days', '${FRIEND}', now() - interval '10 days'),
      ('${OLD}', 'sam@example.com', false, null, null, now() - interval '10 days'),
      ('${OLD_CLOSED}', 'sam@example.com', false, null, null, now() - interval '10 days');
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261011120000_w1c_split_email_guard.sql', import.meta.url), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`reset role;
    delete from split_email_log where split_id = '${NEW}';
    delete from shared_splits where id = '${NEW}';
    insert into shared_splits (id, owner_user_id, currency) values ('${NEW}', '${OWNER}', 'INR');
    insert into shared_split_shares (split_id, email, created_at) values
      ('${NEW}', 'a@example.com', now() - interval '3 seconds'),
      ('${NEW}', 'b@example.com', now() - interval '2 seconds'),
      ('${NEW}', 'c@example.com', now() - interval '1 second');`);
});

describe('split email guard (W1c)', () => {
  it('CON-UNIT-W1-021 · existing shares count as already mailed; currency must be a 3-letter code', async () => {
    const log = await db.query<{ email: string; event: string; split_id: string }>(`
      select sh.email, l.event, l.split_id from split_email_log l join shared_split_shares sh on sh.id = l.share_id
       where l.split_id in ('${OLD}', '${OLD_CLOSED}') order by l.split_id, sh.email, l.event`);
    expect(log.rows.map(r => `${r.split_id === OLD ? 'old' : 'closed'}:${r.email}:${r.event}`)).toEqual([
      'old:friend@example.com:settled', 'old:friend@example.com:shared', 'old:sam@example.com:shared',
      'closed:sam@example.com:closed', 'closed:sam@example.com:shared',
    ]);
    // Re-asking for an old split mails nobody, and none of it counts against today's cap.
    expect(await claim(OLD, 'shared', await shareIds(OLD), 0)).toEqual({ claimed: [], limited: 0 });
    expect((await db.query<{ currency: string }>(`select currency from shared_splits where id = '${OLD}'`)).rows[0].currency).toBe('INR');
    await expect(db.exec(`insert into shared_splits (owner_user_id, currency) values ('${OWNER}', '<a href=x>')`))
      .rejects.toThrow(/ck_shared_split_currency/);
  });

  it('CON-UNIT-W1-022 · each share is mailed once per event; a later call mails only people added since', async () => {
    const ids = await shareIds(NEW);
    expect((await claim(NEW, 'shared', ids)).claimed.sort()).toEqual([...ids].sort());
    expect(await claim(NEW, 'shared', ids)).toEqual({ claimed: [], limited: 0 });
    await db.exec(`insert into shared_split_shares (split_id, email) values ('${NEW}', 'd@example.com')`);
    const all = await shareIds(NEW);
    const added = all.filter(id => !ids.includes(id));
    expect((await claim(NEW, 'shared', all)).claimed).toEqual(added);
    // A share of another split cannot be claimed through this one.
    expect((await claim(NEW, 'closed', [(await shareIds(OLD))[1]])).claimed).toEqual([]);
  });

  it('CON-UNIT-W1-023 · the daily cap holds across splits; a released claim can be sent again', async () => {
    const ids = await shareIds(NEW);
    const first = await claim(NEW, 'shared', ids, 2);
    expect([first.claimed.sort(), first.limited]).toEqual([ids.slice(0, 2).sort(), 1]);
    expect(await claim(NEW, 'shared', ids, 2)).toEqual({ claimed: [], limited: 1 });
    // A failed delivery gives the claim back (the Edge Function deletes the row).
    await db.exec(`delete from split_email_log where share_id = '${ids[0]}' and event = 'shared'`);
    expect(await claim(NEW, 'shared', ids, 2)).toEqual({ claimed: [ids[0]], limited: 1 });
    // Another sender has their own room.
    expect((await claim(NEW, 'closed', [ids[2]], 2, FRIEND)).claimed).toEqual([ids[2]]);
    await expect(claim(NEW, 'shared', ids, null)).rejects.toThrow(/invalid_cap/);
    await expect(claim(NEW, 'spam', ids)).rejects.toThrow(/bad_event/);
  });

  it('CON-UNIT-W1-024 · members can neither claim nor read the log', async () => {
    await db.exec('set role authenticated');
    await expect(db.query('select 1 from split_email_log')).rejects.toThrow(/permission denied/);
    await expect(claim(NEW, 'shared', [])).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
});
