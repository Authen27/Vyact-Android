// Lane B — the cloud lane. Connection details for the DISPOSABLE test project.
//
// 🔴 NEVER POINT THIS AT PRODUCTION.
// Lane B creates and deletes households, and its headline test deliberately
// probes for cross-household data leaks. Both are fine against a throwaway
// project and unacceptable against the database holding real user data. The
// url below is pinned rather than read from env precisely so a stray
// VITE_SUPABASE_URL cannot silently redirect this suite at prod.
//
// Project: vyact-test (xdbfzwltqocyljbgztmv) · eu-west-2 · free tier.
// Schema is applied from db/schema.sql, the same snapshot CI generates, so it
// carries the identical 94 RLS policies, 72 functions and every unique index —
// including `uq_balloc_cat`, the constraint behind defects 1 and 3.

export const TEST_PROJECT_REF = 'xdbfzwltqocyljbgztmv';
export const TEST_SUPABASE_URL = `https://${TEST_PROJECT_REF}.supabase.co`;

/** Publishable (anon) key. Public by design — RLS is what protects the data,
 *  and this is a throwaway project regardless. Same class of value as the
 *  fallback key already committed in `src/lib/supabase.ts`. */
export const TEST_ANON_KEY = 'sb_publishable_q_zjqbi5JUsyiNIdaUeh6g_X5XT4NAJ';

/**
 * Service-role key for the TEST project only, supplied at run time.
 *
 * Needed to provision and tear down test users (the Admin API is the only way
 * to create a confirmed user without going through an email round-trip). It is
 * never committed and never read from any file — set it in your shell for a
 * local run, and as a repository secret for CI.
 *
 * Deliberately fails loudly rather than falling back to anything: a Lane B run
 * that silently degrades to no-auth would report green while testing nothing,
 * which is the exact failure mode this lane exists to eliminate.
 */
export function requireServiceKey(): string {
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error(
      'SUPABASE_TEST_SERVICE_ROLE_KEY is not set.\n\n' +
      `  Get it from: https://supabase.com/dashboard/project/${TEST_PROJECT_REF}/settings/api-keys\n` +
      '  Local:  export SUPABASE_TEST_SERVICE_ROLE_KEY=…\n' +
      '  CI:     add it as a repository secret of the same name.\n\n' +
      'It must be the key for vyact-test. Never the production project.',
    );
  }
  if (key.length < 40) throw new Error('SUPABASE_TEST_SERVICE_ROLE_KEY looks truncated.');
  return key;
}

/** True when Lane B can run at all. Used to skip cleanly rather than fail a
 *  developer who simply has not set the secret. */
export const laneBConfigured = Boolean(process.env.SUPABASE_TEST_SERVICE_ROLE_KEY?.trim());

/** Two users, because the isolation test needs someone to be excluded. */
export const TEST_USERS = {
  a: { email: 'lane-b-a@vyact.test', password: 'lane-b-a-{{RUN}}' },
  b: { email: 'lane-b-b@vyact.test', password: 'lane-b-b-{{RUN}}' },
} as const;
