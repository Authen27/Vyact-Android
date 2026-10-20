-- Q2 (v10.129.0; audit OPS-02, DB-SEC-10): what a Supabase project has before its first migration runs,
-- for replaying every migration on an empty PGlite (helpers/replayMigrations.ts).
--
-- Each object here mirrors the platform's own shape closely enough for the migrations and policies that use it.
-- Nothing here is Vyact's: a Vyact object belongs in a migration. pg_cron and pg_net are NOT here; the
-- migrations create them (`create extension …`), from the stand-ins in pg_cron.sql and pg_net.sql.

-- ── Roles (PostgREST switches to one of these per request) ──────────────────────────────────────────────────
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator noinherit;
grant anon, authenticated, service_role to authenticator;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ── Supabase's default privileges: every table, sequence and function the migrations (run as postgres)
--    create in public is granted to the API roles; RLS and explicit revokes are what close them. ──────────────
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ── auth ─────────────────────────────────────────────────────────────────────────────────────────────────────
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  aud                 text,
  role                text,
  email               text,
  phone               text,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  phone_confirmed_at  timestamptz,
  confirmed_at        timestamptz,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  raw_app_meta_data   jsonb default '{}'::jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  last_sign_in_at     timestamptz,
  banned_until        timestamptz,
  deleted_at          timestamptz,
  is_sso_user         boolean not null default false,
  is_anonymous        boolean not null default false
);
-- The request's JWT claims, as PostgREST sets them (`request.jwt.claims`, one JSON setting).
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create function auth.email() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))::text $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- ── storage ──────────────────────────────────────────────────────────────────────────────────────────────────
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create table storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets(id),
  name             text,
  owner            uuid,
  owner_id         text,
  metadata         jsonb,
  path_tokens      text[],
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now()
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create function storage.extension(name text) returns text language sql immutable as $$
  select reverse(split_part(reverse(name), '.', 1)) $$;

-- ── vault (supabase_vault; preinstalled, never created by a migration). Secrets are stored in the clear here. ─
create schema vault;
create table vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text not null default '',
  secret      text not null,
  key_id      uuid,
  nonce       bytea,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, key_id, nonce, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '',
  new_key_id uuid default null) returns uuid language sql as $$
  insert into vault.secrets (name, secret, description) values (new_name, new_secret, coalesce(new_description, ''))
  returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
  new_description text default null, new_key_id uuid default null) returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
    description = coalesce(new_description, description), updated_at = now()
  where id = secret_id $$;

-- ── Realtime ─────────────────────────────────────────────────────────────────────────────────────────────────
create publication supabase_realtime;
