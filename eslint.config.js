// FinFlow consumer — ESLint flat config.
// First real linter for this app (the old `lint` script was only `tsc --noEmit`,
// preserved as `npm run typecheck`). Genuine-bug rules are errors; pre-existing
// stylistic/debt findings are warnings so the gate is green on introduction and
// the debt can be ratcheted to errors in later TECH_DEBT PRs.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      '.vercel',
      'playwright-report',
      'e2e',
      'test-results',
      'coverage',
      'scripts/**',
      'api/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Node scripts at the project root (check-env.js, eslint.config.js, vite.config.ts etc.)
  // get the node global set so `process`/`console` don't trip `no-undef`.
  {
    files: ['*.js', '*.mjs', '*.cjs', '*.config.{js,ts,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Correctness — keep as errors.
      'react-hooks/rules-of-hooks': 'error',
      // High-value but pre-existing violations exist; surface as warnings for now.
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
