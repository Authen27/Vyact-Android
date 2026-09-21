import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  testMatch: 'dialog-correction.spec.ts',
  outputDir: './e2e/corrective-results',
  retries: 0,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5181',
    screenshot: 'only-on-failure',
  },
});