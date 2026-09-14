import { defineConfig, devices } from '@playwright/test';

/**
 * FinFlow E2E — Playwright config (TD-19).
 *
 * Two execution lanes:
 *   • Lane A (LOCAL, default)  — runs the app in localStorage-only mode (no
 *     Supabase env), seeded deterministically. Fast, no backend, no flake.
 *     This config IS Lane A.
 *   • Lane B (CLOUD)           — auth / multi-household / RLS against a
 *     disposable Supabase test project. Added in a later phase as a separate
 *     project + global-setup (see e2e/README.md).
 *
 * The webServer builds and serves the app with BLANK Supabase env vars, which
 * forces local-only mode (verified: the anon key is not baked into the bundle
 * when these are empty). `vite preview` defaults to port 4173 and does not
 * auto-open a browser, so it is CI-safe.
 */
export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './e2e/.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // E2E_SCREENSHOTS=all captures a screenshot for PASSING tests too, so a
    // release can ship visual evidence per scenario rather than only failures.
    screenshot: process.env.E2E_SCREENSHOTS === 'all' ? 'on' : 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Nightly / pre-release matrix — enable in CI on a schedule, not per-PR.
    // The app is mobile-first (≤820px slide-out sidebar), so a mobile project
    // guards the responsive layout.
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      testIgnore: process.env.E2E_FULL_MATRIX ? undefined : /.*/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: process.env.E2E_FULL_MATRIX ? undefined : /.*/,
    },
  ],

  webServer: {
    // Build in 'test' mode (not 'production') so import.meta.env.MODE is
    // 'test'. This keeps the dev-only store exposure (window.__ff_store in
    // store.ts, guarded by MODE !== 'production') available to tests that read
    // derived state, WITHOUT exposing it in real production builds.
    command: 'npm run build -- --mode test && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    // 180s was marginal: a cold build overran it, and Playwright then EXITS 0
    // having run nothing. A suite that reports success while executing zero
    // tests is the same silent-green failure this lane exists to catch — and it
    // fooled a real review pass before it was noticed. Give the build room.
    timeout: 480_000,
    // Blank Supabase env → local-only mode (no auth, single 'local' household).
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
});
