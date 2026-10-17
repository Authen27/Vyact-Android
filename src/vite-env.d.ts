/// <reference types="vite/client" />

// Typed env vars surfaced by Vite. Add new VITE_* keys here when introduced.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_URL?: string;
  /** v10.57.0 — '1' turns off the production Supabase fallback (preview + demo builds). */
  readonly VITE_LOCAL_ONLY?: string;
  /** v10.57.0 (B20) — '1' on the guest demo build (demo.vyact.app). */
  readonly VITE_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected at build time from package.json via vite.config.ts `define`.
declare const __APP_VERSION__: string;
