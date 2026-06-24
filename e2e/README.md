# FinFlow — E2E / QA Track (TD-19)

End-to-end browser tests with Playwright. This sits above the vitest unit suite
(`src/lib/__tests__/`) in the test pyramid: vitest verifies the pure money math;
Playwright verifies **user journeys and integration seams** (store ↔ adapter ↔
storage, routing, modals, persistence). Don't re-test math here.

## Two execution lanes

| Lane | Mode | Backend | Runs | Status |
|------|------|---------|------|--------|
| **A — Local** | localStorage-only | none | every PR | ✅ implemented |
| **B — Cloud** | Supabase test project | disposable DB | nightly / pre-release | ⬜ planned (Phase 4) |

Lane A is the default and needs **no backend**. The Playwright `webServer`
builds and serves the app with blank `VITE_SUPABASE_*` env vars, which forces
local-only mode (the anon key is not baked into the bundle when those are
empty). Most journeys are fully testable here — fast and flake-free.

Lane B is the only place the cloud-only features can be exercised: auth,
multi-household, invitations, realtime sync, and — most importantly — the
**negative RLS-isolation test** (user A must not be able to read user B's
household). It requires a dedicated, disposable Supabase project (never prod)
and a `globalSetup` that seeds/teardowns test users. Wire it as a separate
Playwright project gated on a `E2E_CLOUD=1` env var.

## Running

```bash
cd react

# headless, builds + serves automatically (port 4173)
npm run e2e

# interactive UI mode (great for writing/debugging tests)
npm run e2e:ui

# open the HTML report from the last run
npm run e2e:report

# cross-browser + mobile matrix (WebKit, Pixel 5) — nightly
E2E_FULL_MATRIX=1 npm run e2e
```

First run only, install the browser binaries:

```bash
npx playwright install chromium          # local
npx playwright install --with-deps chromium   # CI / Linux
```

## Determinism

The `app` fixture (`e2e/fixtures/app.ts`) guarantees repeatable runs:

- **Frozen clock** — `page.clock.setFixedTime(FIXED_NOW)`. The app derives the
  current month from `today()` / `nowMonthKey()` everywhere; without a frozen
  clock, month-boundary assertions flake. `setFixedTime` (not `install`) keeps
  timers firing so the UI stays responsive.
- **Pinned `crypto.randomUUID`** — stable ids for records created mid-test.
- **Seeding** — `test.use({ seed })` injects a known dataset into localStorage
  *before* app boot, via `addInitScript`. Keys mirror `LocalStorageAdapter`'s
  anonymous layout (`ff_transactions`, `ff_budgets`, …). See `fixtures/seed.ts`.

## Layout

```
e2e/
├── fixtures/
│   ├── app.ts      — custom test (clock + uuid + seeding + page objects)
│   └── seed.ts     — FIXED_NOW, deterministic dataset, browser seed/determinism scripts
├── pages/          — Page Object Model (DashboardPage, TransactionsPage, …)
├── tests/          — *.spec.ts journeys
└── README.md
```

## Writing a test

```ts
import { test, expect } from '../fixtures/app';
import { defaultSeed } from '../fixtures/seed';

test.use({ seed: defaultSeed });           // optional pre-population

test('records a transaction', async ({ page, transactions }) => {
  await transactions.goto();
  // ...drive the UI, then assert
});
```

Conventions:
- One Page Object per page under `pages/`; expose **locators** and intent-level
  methods, not raw selectors, to the specs.
- Prefer role / label / user-text locators over CSS. The app has few test ids;
  adding `data-testid` to key surfaces (metric cards, modal submit buttons) is a
  cheap, recommended follow-up to harden locators.
- Keep the suite to ~15–20 high-value journeys.

## Journey backlog (phased)

- **Phase 1 — Foundation (this commit):** config, fixtures, POM, smoke +
  seeded-data + reload-persistence tests, CI job. ✅
- **Phase 2 — Core money journeys (Lane A):** add income/expense → dashboard &
  pulse update; budget over-limit alert; record debt payment → amortization;
  split a bill; multi-currency in reports; backup → wipe → restore round-trip.
- **Phase 3 — Resilience:** error-boundary fallback (couples to TD-05); mobile
  viewport (sidebar/hamburger, stacked panels).
- **Phase 4 — Cloud lane (Lane B):** auth, sign-out→sign-in persistence,
  multi-household switch, invitation accept, **RLS isolation (negative)**.
- **Phase 5 — Hardening:** sharding, cross-browser matrix, optional visual
  snapshots for the design system (nightly, flake-gated).
```
