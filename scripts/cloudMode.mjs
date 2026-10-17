// W7b (audit FE-PUB-10) — does this build run in cloud mode? The landing pre-render (a separate
// "postbuild" process) used to decide from the env file alone, so it never saw vite.config.ts's
// overrides: Vercel previews and demo.vyact.app shipped a landing page with cloud sign-up CTAs on
// an app that runs local-only. This mirrors the runtime rule:
//   • vite.config.ts forces local-only for a Vercel preview without its own VITE_SUPABASE_URL, and for
//     the guest demo (VYACT_DEMO=1); VITE_LOCAL_ONLY=1 turns cloud off outright;
//   • lib/supabase.ts is cloud when it has a URL and a key, from the env or — in a production-mode
//     build that is not local-only — from its built-in production fallback.

/**
 * @param {{ mode: string, env: Record<string, string | undefined>, processEnv: Record<string, string | undefined> }} a
 *   `env` is Vite's loadEnv result (files + shell VITE_* vars), `processEnv` the build's process.env.
 */
export function isCloudBuild({ mode, env, processEnv }) {
  // W8d (OPS-05): a preview given production's URL is local-only too (vite.config.ts fails closed).
  if (processEnv.VERCEL_ENV === 'preview'
      && (!processEnv.VITE_SUPABASE_URL || processEnv.VITE_SUPABASE_URL.includes('dmxqkvploojokffuhxnz'))) return false;
  if (processEnv.VYACT_DEMO === '1') return false;
  if (env.VITE_LOCAL_ONLY === '1' || processEnv.VITE_LOCAL_ONLY === '1') return false;
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) return true;
  return mode !== 'test';   // lib/supabase.ts USE_FALLBACK: PROD && MODE !== 'test' && not local-only
}
