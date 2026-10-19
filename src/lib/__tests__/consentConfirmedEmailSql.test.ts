import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// T4A-001..003 — v10.124.0 (T4a; audit XC-PRV-09, DB-INT-15; owner decisions 19 Oct 2026).
// • The server records which policy version a person accepted, at sign-up, from the sign-up form's
//   metadata: an email sign-up that confirms in a new tab no longer loses its consent record.
// • Split sharing finds a person by their CONFIRMED email only: someone who registers another person's
//   address, unconfirmed, sees and settles none of the splits sent to it.
// Runs the real migrations (the shared-splits schema, then T4a) on PGlite.

const MIGRATIONS = new URL('../../../../supabase/migrations/', import.meta.url);
const db = new PGlite();
const OWNER = '10000000-0000-4000-8000-0000000000a1';
const PRIYA = '10000000-0000-4000-8000-0000000000a2';      // confirmed priya@example.com
const IMPOSTOR = '10000000-0000-4000-8000-0000000000a3';   // registered ravi@example.com, never confirmed
const HH = '20000000-0000-4000-8000-0000000000b1';
const SPLIT = '30000000-0000-4000-8000-0000000000c1';

const as = async <T>(sub: string, fn: () => Promise<T>): Promise<T> => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec('reset role'); }
};

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz,
      raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table profiles (id uuid primary key, display_name text,
      tos_accepted_at timestamptz, tos_version text, privacy_accepted_at timestamptz, privacy_version text);
    create table households (id uuid primary key default gen_random_uuid(), name text not null, type text not null,
      base_currency text, created_by uuid);
    create table transactions (id uuid primary key);
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
    grant usage on schema public to authenticated, anon;
  `);
  await db.exec(readFileSync(new URL('20260724130000_shared_splits.sql', MIGRATIONS), 'utf8'));
  await db.exec(readFileSync(new URL('20261107120000_t4a_consent_and_confirmed_email.sql', MIGRATIONS), 'utf8'));
  await db.exec(`create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();`);
}, 60000);
afterAll(async () => { await db.close(); });

const profile = async (id: string) => (await db.query<{ display_name: string; tos_version: string | null; privacy_version: string | null; privacy_accepted_at: string | null }>(
  `select display_name, tos_version, privacy_version, privacy_accepted_at from profiles where id = '${id}'`)).rows[0];

describe('the server records consent at sign-up (XC-PRV-09)', () => {
  it('T4A-001 · the version on the sign-up form is stamped with the account; none, or a non-version, records nothing', async () => {
    await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, 'owner@example.com', now(), $2)`,
      [OWNER, JSON.stringify({ display_name: 'Asha', policy_version: '2026-10-19' })]);
    expect(await profile(OWNER)).toMatchObject({ display_name: 'Asha', tos_version: '2026-10-19', privacy_version: '2026-10-19' });
    expect((await profile(OWNER)).privacy_accepted_at).not.toBeNull();

    await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, 'priya@example.com', now(), $2)`,
      [PRIYA, JSON.stringify({ full_name: 'Priya Nair' })]);            // a Google sign-up: no form data
    expect(await profile(PRIYA)).toMatchObject({ display_name: 'Priya Nair', privacy_version: null, privacy_accepted_at: null });

    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'ravi@example.com', $2)`,
      [IMPOSTOR, JSON.stringify({ display_name: 'Not Ravi', policy_version: 'yes please' })]);
    expect(await profile(IMPOSTOR)).toMatchObject({ privacy_version: null, privacy_accepted_at: null });
    // The sign-up still makes the first household.
    expect((await db.query<{ n: number }>(`select count(*)::int as n from households`)).rows[0].n).toBe(3);
  });
});

describe('a split finds a person by their confirmed email (DB-INT-15)', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into households (id, name, type, created_by) values ('${HH}', 'Home', 'family', '${OWNER}');
      insert into shared_splits (id, owner_user_id, owner_household_id, description, currency, total_amount, txn_type, date)
        values ('${SPLIT}', '${OWNER}', '${HH}', 'Dinner', 'INR', 3000, 'expense', '2026-10-19');
      insert into shared_split_shares (split_id, email, share) values ('${SPLIT}', 'priya@example.com', 1000), ('${SPLIT}', 'ravi@example.com', 1000);
    `);
  });

  it('T4A-002 · a confirmed participant sees and settles her share', async () => {
    await as(PRIYA, async () => {
      expect((await db.query<{ e: string }>('select public.my_email() as e')).rows[0].e).toBe('priya@example.com');
      expect((await db.query<{ ok: boolean }>(`select public.is_split_participant('${SPLIT}') as ok`)).rows[0].ok).toBe(true);
      const mine = (await db.query<{ id: string }>(`select id from shared_split_shares where email = 'priya@example.com'`)).rows;
      expect(mine).toHaveLength(1);
      await db.query('select public.settle_share($1)', [mine[0].id]);
    });
    expect((await db.query<{ paid: boolean }>(`select paid from shared_split_shares where email = 'priya@example.com'`)).rows[0].paid).toBe(true);
  });

  it('T4A-003 · an unconfirmed address sees and settles nothing, and is told to confirm; once confirmed, it works', async () => {
    const raviShare = (await db.query<{ id: string }>(`select id from shared_split_shares where email = 'ravi@example.com'`)).rows[0].id;
    await as(IMPOSTOR, async () => {
      expect((await db.query<{ e: string | null }>('select public.my_email() as e')).rows[0].e).toBeNull();
      expect((await db.query<{ ok: boolean }>(`select public.is_split_participant('${SPLIT}') as ok`)).rows[0].ok).toBe(false);
      expect((await db.query('select id from shared_split_shares')).rows).toEqual([]);
      expect((await db.query('select id from shared_splits')).rows).toEqual([]);
      await expect(db.query('select public.settle_share($1)', [raviShare])).rejects.toThrow(/Confirm your email address/);
    });
    expect((await db.query<{ paid: boolean }>(`select paid from shared_split_shares where id = '${raviShare}'`)).rows[0].paid).toBe(false);

    await db.exec(`update auth.users set email_confirmed_at = now() where id = '${IMPOSTOR}'`);   // the real Ravi confirms
    await as(IMPOSTOR, async () => {
      expect((await db.query<{ ok: boolean }>(`select public.is_split_participant('${SPLIT}') as ok`)).rows[0].ok).toBe(true);
      expect((await db.query('select id from shared_split_shares')).rows).toHaveLength(1);
    });
  });
});
