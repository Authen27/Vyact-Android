import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// T5D-001..003 — v10.123.0 (T5d; audit DB-OPS-07, BE-FN-11; owner, 19 Oct 2026: "Deploy writes it").
// Every scheduled job that calls an Edge Function builds its URL from this project's Vault `project_url`,
// which each project's deploy writes through set_project_url(). A database without it calls nothing; before,
// every job named the production host, so vyact-test called production every few minutes.
// Runs the real migration on PGlite, with cron, vault and pg_net stood in by tables that record calls.

const MIGRATIONS = new URL('../../../../supabase/migrations/', import.meta.url);
const db = new PGlite();
const JOBS = ['whatsapp-dispatch-alerts', 'whatsapp-dispatch-weekly', 'whatsapp-dispatch-bills', 'whatsapp-dispatch-digest',
  'whatsapp-dispatch-monthly', 'web-push-dispatch', 'recurring-post', 'whatsapp-inbox-sweep'];

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema cron; create schema vault; create schema net;
    create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
    create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
      database text default null, username text default null, active boolean default null) returns void language sql as
      $$ update cron.job set schedule = coalesce(alter_job.schedule, job.schedule), command = coalesce(alter_job.command, job.command) where jobid = job_id $$;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text, new_name text, new_description text default '') returns uuid language sql as
      $$ insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $$;
    create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
      returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
    create table net.calls (url text, headers jsonb);
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as
      $$ insert into net.calls values (url, headers) returning 1 $$;
    insert into vault.secrets (name, secret) values ('whatsapp_dispatch_secret', 'd-secret'), ('web_push_cron_secret', 'w-secret'),
      ('recurring_post_cron_secret', 'r-secret'), ('whatsapp_sweep_cron_secret', 's-secret');
  `);
  // The jobs as their own migrations scheduled them: the production host in every command.
  for (const name of JOBS) {
    await db.query(`insert into cron.job (jobname, schedule, command) values ($1, '*/15 * * * *',
      'select net.http_post(url := ''https://dmxqkvploojokffuhxnz.supabase.co/functions/v1/x'', headers := ''{}''::jsonb, body := ''{}''::jsonb, timeout_milliseconds := 1)')`, [name]);
  }
  await db.exec(readFileSync(new URL('20261106120000_t5d_cron_project_url.sql', MIGRATIONS), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });

const runAll = async () => {
  await db.exec('delete from net.calls');
  for (const { command } of (await db.query<{ command: string }>('select command from cron.job order by jobid')).rows) await db.exec(command);
  return (await db.query<{ url: string; headers: Record<string, string> }>('select url, headers from net.calls')).rows;
};

describe('scheduled jobs call this project, from its own project_url (DB-OPS-07)', () => {
  it('T5D-001 · no project_url: no job calls anything, and no command names a host', async () => {
    expect(await runAll()).toEqual([]);
    const commands = (await db.query<{ command: string }>('select command from cron.job')).rows.map(r => r.command);
    expect(commands).toHaveLength(8);
    for (const c of commands) expect(c).not.toMatch(/supabase\.co/);
  });

  it('T5D-002 · with project_url set, each job calls its own function on this project, with its own secret', async () => {
    expect((await db.query<{ u: string }>(`select public.set_project_url('https://xdbfzwltqocyljbgztmv.supabase.co/') as u`)).rows[0].u)
      .toBe('https://xdbfzwltqocyljbgztmv.supabase.co');
    const calls = await runAll();
    expect(calls.map(c => c.url)).toEqual([
      'https://xdbfzwltqocyljbgztmv.supabase.co/functions/v1/whatsapp-dispatch?job=alerts',
      'https://xdbfzwltqocyljbgztmv.supabase.co/functions/v1/whatsapp-dispatch?job=weekly',
      'https://xdbfzwltqocyljbgztmv.supabase.co/functions/v1/whatsapp-dispatch?job=bills',
      'https://xdbfzwltqocyljbgztmv.supabase.co/functions/v1/whatsapp-dispatch?job=digest',
      'https://xdbfzwltqocyljbgztmv.supabase.co/functions/v1/whatsapp-dispatch?job=monthly',
      'https://xdbfzwltqocyljbgztmv.supabase.co/functions/v1/web-push?mode=dispatch',
      'https://xdbfzwltqocyljbgztmv.supabase.co/functions/v1/recurring-post',
      'https://xdbfzwltqocyljbgztmv.supabase.co/functions/v1/whatsapp-webhook?mode=sweep',
    ]);
    expect(calls.map(c => Object.entries(c.headers).find(([k]) => k !== 'Content-Type'))).toEqual([
      ['x-dispatch-secret', 'd-secret'], ['x-dispatch-secret', 'd-secret'], ['x-dispatch-secret', 'd-secret'],
      ['x-dispatch-secret', 'd-secret'], ['x-dispatch-secret', 'd-secret'],
      ['x-cron-secret', 'w-secret'], ['x-cron-secret', 'r-secret'], ['x-cron-secret', 's-secret'],
    ]);
    // A second write updates it in place (the deploy runs every time).
    await db.query(`select public.set_project_url('https://dmxqkvploojokffuhxnz.supabase.co')`);
    expect((await runAll())[0].url).toBe('https://dmxqkvploojokffuhxnz.supabase.co/functions/v1/whatsapp-dispatch?job=alerts');
    expect((await db.query<{ n: number }>(`select count(*)::int as n from vault.secrets where name = 'project_url'`)).rows[0].n).toBe(1);
  });

  it('T5D-003 · only a Supabase project URL is accepted, and the app cannot call it', async () => {
    for (const bad of ['http://xdbfzwltqocyljbgztmv.supabase.co', 'https://evil.example.com', 'https://short.supabase.co', '']) {
      await expect(db.query('select public.set_project_url($1)', [bad])).rejects.toThrow(/project_url_invalid/);
    }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query(`select public.set_project_url('https://xdbfzwltqocyljbgztmv.supabase.co')`)).rejects.toThrow(/permission denied/);
      } finally { await db.exec('reset role'); }
    }
  });
});

describe('no migration names the production host in a job any more', () => {
  it('T5D-004 · the jobs are rewritten by the latest migration that touches them', () => {
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
    const t5d = files.indexOf('20261106120000_t5d_cron_project_url.sql');
    expect(t5d).toBeGreaterThan(-1);
    for (const f of files.slice(t5d + 1)) {
      expect(readFileSync(new URL(f, MIGRATIONS), 'utf8'), f).not.toMatch(/dmxqkvploojokffuhxnz\.supabase\.co/);
    }
  });
});
