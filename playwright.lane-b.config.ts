import { defineConfig } from '@playwright/test';

/**
 * Vyact E2E — LANE B (cloud).
 *
 * A separate config rather than a project inside playwright.config.ts, because
 * the two lanes share nothing that matters: Lane A builds and serves the app in
 * localStorage-only mode; Lane B talks to a real Postgres and needs no server
 * and no browser at all.
 *
 * WHAT IT COVERS — and only Lane B can:
 *   • unique indexes and CHECK constraints (Lane A has no database to violate)
 *   • RLS, including the negative isolation case
 *   • anything where "the write silently affected zero rows" is the bug
 *
 * TARGET: vyact-test (xdbfzwltqocyljbgztmv), a disposable free-tier project.
 * Never production — see the note at the top of e2e/lane-b/env.ts.
 *
 * RUN IT:
 *   export SUPABASE_TEST_SERVICE_ROLE_KEY=…
 *   npx playwright test --config=playwright.lane-b.config.ts
 *
 * Without that key the suite fails fast with instructions rather than skipping,
 * because a cloud lane that quietly runs zero tests is worse than no lane —
 * that is exactly how Lane A stayed "green" while testing nothing.
 */
export default defineConfig({
  testDir: './e2e/lane-b',
  outputDir: './e2e/.results-lane-b',
  // Serial. These specs share one test project, and parallel household churn
  // makes teardown races that read as flaky RLS failures.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retries: a flaky isolation test is a finding, not something to paper
  // over by running it again.
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-lane-b', open: 'never' }]],
  use: { trace: 'on-first-retry' },
});
