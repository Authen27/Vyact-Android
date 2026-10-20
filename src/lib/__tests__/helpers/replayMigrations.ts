import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';

// Q2 (v10.129.0; audit OPS-02, DB-SEC-10, OPS-08; owner decision D10, 20 Oct 2026: "replay every migration").
//
// An empty PGlite set up as a new Supabase project would be, then every file in supabase/migrations applied in
// the order `supabase db push` applies them, each exactly as written (no text is rewritten). What the platform
// provides comes from ./supabase-standin:
//   - platform.sql: the API roles, Supabase's default grants, auth, storage, vault and the realtime publication;
//   - pg_cron.sql and pg_net.sql: installed as extensions, so the migrations' own `create extension` statements
//     create them (and a migration that used cron before creating it would fail here, as in production).
// pgcrypto, pg_trgm and uuid-ossp are PGlite's real builds of those extensions.

export const MIGRATIONS_DIR = new URL('../../../../../supabase/migrations/', import.meta.url);
const STANDIN = new URL('./supabase-standin/', import.meta.url);

/** Every migration, in the order `supabase db push` applies them (file name order). */
export const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

/** The extensions the migrations create that PGlite does not ship: name → [control file, install script]. */
const STANDIN_EXTENSIONS: Record<string, { version: string; control: string; script: string }> = {
  pg_cron: { version: '1.6', control: 'relocatable = false\nschema = pg_catalog\nsuperuser = true\n', script: 'pg_cron.sql' },
  pg_net: { version: '0.14', control: 'relocatable = false\nsuperuser = true\n', script: 'pg_net.sql' },
};

interface EmscriptenFs { writeFile(path: string, data: string): void }

/** PGlite keeps its Emscripten module protected; the stand-in extension files are written into its share dir. */
function fsOf(db: PGlite): EmscriptenFs {
  const fs = (db as unknown as { mod?: { FS?: EmscriptenFs } }).mod?.FS;
  if (!fs) throw new Error('PGlite no longer exposes its file system (mod.FS); update helpers/replayMigrations.ts');
  return fs;
}

export class MigrationFailed extends Error {
  constructor(readonly file: string, reason: unknown) {
    super(`${file} failed to apply: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
}

/** A fresh database with the platform stand-ins and every migration applied. Throws MigrationFailed naming the first file that does not apply. */
export async function replayMigrations(): Promise<{ db: PGlite; applied: string[] }> {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, uuid_ossp } });
  await db.waitReady;
  const share = (await db.query<{ setting: string }>(`select setting from pg_config where name = 'SHAREDIR'`)).rows[0].setting;
  const fs = fsOf(db);
  for (const [name, ext] of Object.entries(STANDIN_EXTENSIONS)) {
    fs.writeFile(`${share}/extension/${name}.control`,
      `comment = '${name} stand-in (Vyact tests)'\ndefault_version = '${ext.version}'\n${ext.control}`);
    fs.writeFile(`${share}/extension/${name}--${ext.version}.sql`, readFileSync(new URL(ext.script, STANDIN), 'utf8'));
  }
  await db.exec(readFileSync(new URL('platform.sql', STANDIN), 'utf8'));

  const applied: string[] = [];
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'));
    } catch (e) {
      await db.close();
      throw new MigrationFailed(file, e);
    }
    applied.push(file);
  }
  return { db, applied };
}
