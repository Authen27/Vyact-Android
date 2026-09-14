import { defineConfig } from '@playwright/test';
import localPreview from './playwright.help.config';

export default defineConfig(localPreview, {
  testMatch: 'finance-guidance.spec.ts',
  outputDir: './test-results/finance-guidance',
  reporter: [['list'], ['json', { outputFile: '../test-results/finance-guidance.json' }]],
});