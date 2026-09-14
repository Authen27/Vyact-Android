import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: { 'https://esm.sh/@supabase/supabase-js@2.45.0': require.resolve('@supabase/supabase-js') },
  },
  test: {
    environment: 'node',
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/lib/__tests__/askVyactLive.test.ts'],
    pool: 'threads',
    maxWorkers: 2,
    globals: false,
  },
});
