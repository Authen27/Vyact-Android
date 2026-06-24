// Vyact v7.0.0 — Supabase client
//
// Singleton client. Exports `supabase` (or null if not configured).
// Use `isCloudEnabled()` to gate cloud-aware features so the app
// continues to work in pure-localStorage mode for users who haven't
// set up Supabase yet.
//
// IMPORTANT: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set
// at BUILD TIME (in env before running npm run build). On Vercel, set
// these in Project Settings → Environment Variables.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// PUBLIC client config. Prefer build-time env (VITE_SUPABASE_*). In a
// PRODUCTION build, fall back to the known public project URL + publishable
// key so the deployed app is ALWAYS DB-connected — even when the host's env
// injection is empty or mis-ordered. (Root cause of the v6.4.26 "dummy data"
// regression: `vercel pull` writes an empty .env.local that Vite ranks above
// .env.production, so the committed values were silently overridden and the
// build shipped in local-only mode.) These are public values; security is
// enforced by Row-Level Security. NEVER hardcode the service_role/secret key.
// In dev (no env, not PROD) the fallback is skipped so `npm run dev` stays in
// local-only mode unless you provide .env.local.
const FALLBACK_URL = 'https://dmxqkvploojokffuhxnz.supabase.co';
const FALLBACK_KEY = 'sb_publishable_SpuQFPzUWOnKI3nRR6ghNw_ktWqrKCA';
// Apply the production fallback for REAL prod builds only. The e2e suite builds
// with `--mode test` (import.meta.env.MODE === 'test') and must stay local-only
// so journeys aren't gated behind the cloud auth screen — without this guard a
// prod-style test build picks up the fallback creds and every route redirects
// to /auth/sign-in. Real deploys (MODE === 'production') keep the fallback.
const USE_FALLBACK = import.meta.env.PROD && import.meta.env.MODE !== 'test';
const URL  = (import.meta.env.VITE_SUPABASE_URL  as string | undefined) || (USE_FALLBACK ? FALLBACK_URL : undefined);
const KEY  = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || (USE_FALLBACK ? FALLBACK_KEY : undefined);
export const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) || (typeof window !== 'undefined' ? window.location.origin : '');

export const isCloudEnabled = (): boolean => {
  const enabled = Boolean(URL && KEY);
  if (!enabled && typeof window !== 'undefined') {
    console.warn('[Vyact] Cloud not enabled. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local or Vercel env vars.');
  }
  return enabled;
};

export const supabase: SupabaseClient | null = isCloudEnabled()
  ? createClient(URL!, KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,    // for magic-link redirects
        flowType: 'pkce',
        debug: import.meta.env.DEV,   // verbose auth logging in dev
      },
      realtime: { params: { eventsPerSecond: 10 } },
      global: {
        headers: {
          'X-Client-Info': `vyact/v7.0.0`,
        },
      },
    })
  : null;

/**
 * Throws if cloud isn't configured. Use in code paths that REQUIRE Supabase
 * (auth, multi-household, invitations). Local features can simply check
 * isCloudEnabled() and gracefully degrade.
 */
export function sb(): SupabaseClient {
  if (!supabase) {
    const msg = `
  [Vyact Cloud Error]
  Cloud is not enabled. This likely means Supabase env vars were not set during build.

  **FOR DEVELOPMENT:**
  1. Copy .env.example to .env.local
  2. Add your Supabase URL and anon key
  3. Run: npm run dev

  **FOR VERCEL DEPLOYMENT:**
  1. Go to Vercel Dashboard → Project → Settings → Environment Variables
  2. Add these variables (get values from https://supabase.com/dashboard):
     - VITE_SUPABASE_URL=https://your-project.supabase.co
     - VITE_SUPABASE_ANON_KEY=your-anon-key-here
    - VITE_APP_URL=\${VERCEL_URL} or your custom domain
  3. Redeploy the project
  4. Check Supabase dashboard for CORS settings (allow your Vercel domain)
  5. Configure Auth Redirect URLs in Supabase

  **FOR DEBUGGING:**
  - Check Vercel Deployment logs for env var warnings
  - Verify Supabase project is accessible and RLS policies are correct
  - Enable CORS for your deployment URL in Supabase dashboard
    `.trim();
    throw new Error(msg);
  }
  return supabase;
}
