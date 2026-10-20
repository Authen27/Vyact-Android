import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationFiles, replayMigrations } from './helpers/replayMigrations';

// Q2-RP-001..006 — v10.129.0 (Q2; audit OPS-02, DB-SEC-10, XC-ARC-13; owner decision D10, 20 Oct 2026:
// "replay every migration"). Until now a migration first ran on production (`supabase db push` in Deploy):
// nothing applied the files in order beforehand. This replays every file in supabase/migrations, exactly as
// written, on an empty PGlite set up as a new Supabase project (helpers/replayMigrations.ts), so a migration
// that does not apply after the ones before it fails here, on the pull request.

let db: PGlite | undefined;
let applied: string[] = [];
let failure: unknown;

beforeAll(async () => {
  try { ({ db, applied } = await replayMigrations()); }
  catch (e) { failure = e; }
}, 180_000);
afterAll(async () => { await db?.close(); });

const q = async <T>(sql: string) => {
  if (!db) throw new Error('the replay did not finish');
  return (await db.query<T>(sql)).rows;
};

describe('every migration replays, in order, on an empty database (OPS-02)', () => {
  it('Q2-RP-001 · each file applies after the ones before it', () => {
    expect(failure, String(failure)).toBeUndefined();
    expect(applied).toEqual(migrationFiles());
    expect(applied.length).toBeGreaterThan(100);
  });

  it('Q2-RP-002 · the migrations create pg_cron and pg_net themselves; the rest are the baseline\'s', async () => {
    const ext = await q<{ extname: string }>(`select extname from pg_extension order by 1`);
    expect(ext.map(e => e.extname)).toEqual(['pg_cron', 'pg_net', 'pg_trgm', 'pgcrypto', 'plpgsql', 'uuid-ossp']);
  });

  it('Q2-RP-003 · a new project gets these scheduled jobs, at these times', async () => {
    const jobs = await q<{ jobname: string; schedule: string }>(`select jobname, schedule from cron.job order by jobname`);
    expect(jobs).toEqual([
      { jobname: 'loan-auto-record', schedule: '20,50 * * * *' },
      { jobname: 'recurring-post', schedule: '10,40 * * * *' },
      { jobname: 'web-push-dispatch', schedule: '*/15 * * * *' },
      { jobname: 'whatsapp-dispatch-alerts', schedule: '*/15 * * * *' },
      // W3a: the four slot jobs run every 30 minutes and act in each household's local slot.
      { jobname: 'whatsapp-dispatch-bills', schedule: '0,30 * * * *' },
      { jobname: 'whatsapp-dispatch-digest', schedule: '0,30 * * * *' },
      { jobname: 'whatsapp-dispatch-monthly', schedule: '0,30 * * * *' },
      { jobname: 'whatsapp-dispatch-weekly', schedule: '0,30 * * * *' },
      { jobname: 'whatsapp-inbox-sweep', schedule: '*/5 * * * *' },
      { jobname: 'whatsapp-retention', schedule: '40 2 * * *' },
    ]);
  });

  it('Q2-RP-004 · every job\'s command runs against the schema the migrations built', async () => {
    if (!db) throw new Error('the replay did not finish');
    const jobs = await q<{ jobname: string; command: string }>(`select jobname, command from cron.job order by jobname`);
    const broken: string[] = [];
    for (const { jobname, command } of jobs) {
      // A job that calls a function a later migration renamed or dropped would fail every run in production,
      // with nothing but a cron.job_run_details row to say so.
      await db.exec('begin');
      try { await db.exec(command); }
      catch (e) { broken.push(`${jobname}: ${e instanceof Error ? e.message : e}`); }
      finally { await db.exec('rollback'); }
    }
    expect(broken).toEqual([]);
    // With no project_url in Vault (T5d), the HTTP jobs call nothing.
    expect(await q(`select 1 from net.http_request_queue`)).toEqual([]);
  });

  it('Q2-RP-005 · row-level security is on for every table in public, but one (DB-OPS-03, Track Q3)', async () => {
    const off = await q<{ relname: string }>(`select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity order by 1`);
    // migration_issues is a production-only table the baseline recorded without RLS; Q3 (owner decision D4)
    // turns it on. When it does, this list becomes empty: keep it that way.
    expect(off.map(r => r.relname)).toEqual(['migration_issues']);
  });

  it('Q2-RP-006 · every SECURITY DEFINER function in public pins its search_path', async () => {
    const unpinned = await q<{ fn: string }>(`select p.oid::regprocedure::text as fn from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      order by 1`);
    expect(unpinned).toEqual([]);
  });
});
