import { defineConfig } from '@playwright/test';
import pilot from './playwright.category.config';

export default defineConfig(pilot, {
  testMatch: 'help-guide.spec.ts',
  outputDir: './test-results/help-guide',
  reporter: [['list'], ['json', { outputFile: '../test-results/help-guide.json' }]],
  use: { ...pilot.use, baseURL: process.env.HELP_PREVIEW_URL ?? 'http://127.0.0.1:5183', serviceWorkers: 'block' },
});