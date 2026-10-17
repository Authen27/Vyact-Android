import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  testMatch: 'category-picker.spec.ts',
  outputDir: './test-results/category-picker',
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [['list'], ['json', { outputFile: '../test-results/category-picker.json' }]],
  use: { ...devices['Desktop Chrome'], baseURL: process.env.UI_PILOT_URL ?? 'http://127.0.0.1:5183', serviceWorkers: 'block', reducedMotion: 'reduce', screenshot: 'only-on-failure' },
});