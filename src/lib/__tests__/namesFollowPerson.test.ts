import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { followedValue } from '../followedField';

// NAME-001..005 — v10.113.0 (owner, 18 Oct 2026: "why does the name of the account go empty or
// prefilled by email IDs"). Three causes:
//   • sign-up named every Google account after its email (it read only `display_name`);
//   • a member's household name was a copy made at join time that a rename never reached;
//   • Settings' name box (and extra payment) copied the profile once, so opened before it loaded it
//     stayed empty (or 0, and Save wrote the 0 back).
// Runs the real migration over a fixture shaped like the baseline (auth.users, profiles with the
// WhatsApp column guard, households with the owner-membership trigger, memberships).

const ROOT = resolvePath(__dirname, '../../../..');
const MIGRATION = 'supabase/migrations/20261030120000_names_follow_the_person.sql';
const db = new PGlite();

const GOOGLE_OLD = '10000000-0000-4000-8000-000000000001';   // signed up with Google before: named "uday.kr27"
const RENAMED = '10000000-0000-4000-8000-000000000002';      // set "Meera Iyer" later; copies kept "meera"
const EMAIL_ONLY = '10000000-0000-4000-8000-000000000003';   // email sign-up, no provider name: stays as is
const CHOSEN = '10000000-0000-4000-8000-000000000004';       // chose "Sam", Google says "Samuel K": keep "Sam"
const H1 = '20000000-0000-4000-8000-000000000001';
const H2 = '20000000-0000-4000-8000-000000000002';

const names = async (sql: string) => (await db.query<{ display_name: string }>(sql)).rows.map(r => r.display_name);
const profileName = async (id: string) => (await names(`select display_name from profiles where id = '${id}'`))[0];
const memberNames = async (id: string) => names(`select display_name from memberships where user_id = '${id}' order by household_id`);

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create table profiles (id uuid primary key, display_name text, phone_number text, phone_verified_at timestamptz,
      whatsapp_household_id uuid, updated_at timestamptz not null default now());
    create table households (id uuid primary key default gen_random_uuid(), name text not null, type text not null,
      base_currency text, created_by uuid);
    create table memberships (id uuid primary key default gen_random_uuid(),
      household_id uuid not null references households(id) on delete cascade, user_id uuid,
      role text not null, display_name text not null, household_role text, joined_at timestamptz not null default now());

    -- The baseline's sign-up pair: the profile and first household, then the owner membership.
    create function public.handle_new_user() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
    create function public.handle_new_household() returns trigger language plpgsql security definer set search_path to 'public' as $$
    begin
      insert into memberships (household_id, user_id, role, display_name, household_role)
      values (new.id, new.created_by, 'owner', coalesce((select display_name from profiles where id = new.created_by), 'Owner'), 'primary');
      return new;
    end $$;
    create trigger on_household_created after insert on households for each row execute function handle_new_household();
    -- The WhatsApp column guard on profiles (audit S1) fires on every profile update.
    create function public.guard_whatsapp_profile_columns() returns trigger language plpgsql as $$
    begin
      if new.phone_number is not distinct from old.phone_number then return new; end if;
      raise exception 'server-managed';
    end $$;
    create trigger trg_guard_whatsapp_profile_columns before update on profiles for each row execute function guard_whatsapp_profile_columns();

    -- Accounts as they stand before the migration.
    insert into auth.users values
      ('${GOOGLE_OLD}', 'uday.kr27@gmail.com', '{"full_name":"Uday Reddy","name":"Uday Reddy","avatar_url":"x"}'),
      ('${RENAMED}', 'meera@example.com', '{"display_name":"meera"}'),
      ('${EMAIL_ONLY}', 'ravi@example.com', '{"display_name":"ravi"}'),
      ('${CHOSEN}', 'sam@example.com', '{"display_name":"Sam","full_name":"Samuel K"}');
    insert into profiles (id, display_name) values
      ('${GOOGLE_OLD}', 'uday.kr27'), ('${RENAMED}', 'Meera Iyer'), ('${EMAIL_ONLY}', 'ravi'), ('${CHOSEN}', 'Sam');
    insert into households (id, name, type, created_by) values ('${H1}', 'Home', 'family', null), ('${H2}', 'Parents', 'family', null);
    insert into memberships (household_id, user_id, role, display_name) values
      ('${H1}', '${GOOGLE_OLD}', 'owner', 'uday.kr27'), ('${H2}', '${GOOGLE_OLD}', 'member', 'uday.kr27'),
      ('${H1}', '${RENAMED}', 'member', 'meera'), ('${H2}', '${RENAMED}', 'member', 'meera'),
      ('${H1}', '${EMAIL_ONLY}', 'member', 'ravi'), ('${H1}', '${CHOSEN}', 'member', 'Sam');
  `);
  await db.exec(readFileSync(resolvePath(ROOT, MIGRATION), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });

describe('names follow the person (database)', () => {
  it('NAME-001 · existing accounts: a Google account named after its email takes its Google name, everywhere; a chosen name stays', async () => {
    expect(await profileName(GOOGLE_OLD)).toBe('Uday Reddy');
    expect(await memberNames(GOOGLE_OLD)).toEqual(['Uday Reddy', 'Uday Reddy']);
    // Renamed before: the household copies that still said "meera" now say the profile's name.
    expect(await profileName(RENAMED)).toBe('Meera Iyer');
    expect(await memberNames(RENAMED)).toEqual(['Meera Iyer', 'Meera Iyer']);
    // No provider name to take: unchanged. A name the person chose is never replaced by Google's.
    expect(await profileName(EMAIL_ONLY)).toBe('ravi');
    expect(await profileName(CHOSEN)).toBe('Sam');
    expect(await memberNames(CHOSEN)).toEqual(['Sam']);
  });

  it('NAME-002 · sign-up takes the name from the form, else the provider, else the email', async () => {
    await db.exec(`insert into auth.users values
      ('10000000-0000-4000-8000-0000000000a1', 'priya.s@gmail.com', '{"full_name":"Priya Sharma"}'),
      ('10000000-0000-4000-8000-0000000000a2', 'arjun@example.com', '{"display_name":"Arjun","full_name":"Arjun Mehta"}'),
      ('10000000-0000-4000-8000-0000000000a3', 'gh@example.com', '{"name":"Octo Cat"}'),
      ('10000000-0000-4000-8000-0000000000a4', 'nobody@example.com', '{"display_name":"  "}')`);
    expect(await profileName('10000000-0000-4000-8000-0000000000a1')).toBe('Priya Sharma');   // Google
    expect(await profileName('10000000-0000-4000-8000-0000000000a2')).toBe('Arjun');          // the form wins
    expect(await profileName('10000000-0000-4000-8000-0000000000a3')).toBe('Octo Cat');       // GitHub
    expect(await profileName('10000000-0000-4000-8000-0000000000a4')).toBe('nobody');         // blank: the email
    // Their first household's owner membership carries the same name.
    expect(await memberNames('10000000-0000-4000-8000-0000000000a1')).toEqual(['Priya Sharma']);
  });

  it('NAME-003 · a rename reaches every household copy that showed the old name; a blank name never does', async () => {
    await db.exec(`update memberships set display_name = 'Ravi (Parents)' where user_id = '${EMAIL_ONLY}' and household_id = '${H1}';
      insert into memberships (household_id, user_id, role, display_name) values ('${H2}', '${EMAIL_ONLY}', 'member', 'ravi');`);
    await db.exec(`update profiles set display_name = 'Ravi Kumar' where id = '${EMAIL_ONLY}'`);
    // The copy that said "ravi" follows; one set on purpose for a household is kept.
    expect(await memberNames(EMAIL_ONLY)).toEqual(['Ravi (Parents)', 'Ravi Kumar']);
    await db.exec(`update profiles set display_name = '' where id = '${EMAIL_ONLY}'`);
    expect(await memberNames(EMAIL_ONLY)).toEqual(['Ravi (Parents)', 'Ravi Kumar']);
  });

  it('NAME-004 · the migration is safe to run again', async () => {
    const before = (await db.query('select id, display_name from memberships order by id')).rows;
    await db.exec(readFileSync(resolvePath(ROOT, MIGRATION), 'utf8'));
    const after = (await db.query('select id, display_name from memberships order by id')).rows;
    expect(after).toEqual(before);                    // nothing out of step: nothing changes
    expect(await profileName(GOOGLE_OLD)).toBe('Uday Reddy');
  });
});

describe('Settings shows the loaded name, not an empty box (app)', () => {
  it('NAME-005 · a field follows the loaded value until edited, then keeps the edit; Settings uses it for the name and the extra payment', () => {
    expect(followedValue({ value: '', edited: false }, 'Uday Reddy')).toBe('Uday Reddy');   // loaded after opening
    expect(followedValue({ value: 'Uday R', edited: true }, 'Uday Reddy')).toBe('Uday R');  // the person's edit
    expect(followedValue({ value: '0', edited: false }, '5000')).toBe('5000');               // never a stale 0
    const settings = readFileSync(resolvePath(ROOT, 'react/src/pages/Settings.tsx'), 'utf8');
    expect(settings).toMatch(/const \[name, setName, followName\] = useFollowedField\(profile\.name\);/);
    expect(settings).toMatch(/const \[extraPay, setExtraPay, followExtraPay\] = useFollowedField\(String\(profile\.extraPayment \|\| 0\)\);/);
    expect(settings).not.toMatch(/useState\(profile\.name\)/);
  });
});
