/// <reference types="vite/client" />

// Typed env vars surfaced by Vite. Add new VITE_* keys here when introduced.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected at build time from package.json via vite.config.ts `define`.
declare const __APP_VERSION__: string;
