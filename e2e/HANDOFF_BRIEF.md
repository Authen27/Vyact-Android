# Handoff Brief — FinFlow E2E Test Build-Out

> Self-contained brief for the QA implementer. Fields in `<…>` are
> placeholders for the delegating lead to fill in before forwarding.

---

## Hi <NAME>,

You're picking up the FinFlow consumer-app Playwright build-out. The
scaffolding is already in `main` — your job is to take the test
inventory from **6 implemented → 163 implemented** over roughly the
next **<TIMELINE, e.g. 6 months>**, one functional area at a time. I'll
review every PR within **24 hours** against a fixed checklist; reach
out in `<SLACK CHANNEL>` or DM me `<HANDLE>` when you're blocked.

Read this brief end-to-end before opening a single file. It has the
context you need and the order you need it in.

---

## What FinFlow is, in 60 seconds

A household finance app — transactions, budgets, goals, debts, assets,
splits. Two deployable modes: **local-only** (no backend, default for
our tests) and **cloud** (Supabase, gated by env vars). All consumer
code lives in `react/`; you'll work entirely in `react/e2e/`.

The cloud lane is **Phase 4** of your work — for the first ~3 months
you're in pure local-only mode and don't need a backend at all.

---

## What's already built (don't rebuild this)

| Layer | What's there | Where |
|---|---|---|
| Fixtures | Frozen clock, pinned UUID, `seedWith()`, `advanceClock()` | `react/e2e/fixtures/` |
| Page Objects | `TransactionsPage`, `TransactionFormModal`, `NetWorthPage`, `Budgets/Goals/Debts/Assets` | `react/e2e/pages/` |
| Golden tests | One per S / M / C complexity tier | `react/e2e/tests/{transactions-create,networth-impact,debts-payment}.spec.ts` |
| Inventory | 163 designed test cases, owned in-repo | `react/e2e/TEST_CASE_INVENTORY.md` |
| Review process | Checklist + 15-min reviewer budget | `react/e2e/REVIEW_CHECKLIST.md` |

---

## Read these, in this order, before you write code

1. **`react/e2e/README.md`** — how to run the suite locally
2. **`react/e2e/TEST_CASE_INVENTORY.md`** — your source of truth.
   Read it cover-to-cover once. You'll come back to it constantly.
3. **`react/e2e/REVIEW_CHECKLIST.md`** — the rules I'll review against.
   This is short. Know it.
4. **`react/e2e/tests/transactions-create.spec.ts`** — S-tier golden
   template. Most of your tests will look like this.
5. **`react/e2e/tests/networth-impact.spec.ts`** — M-tier (cross-module).
6. **`react/e2e/tests/debts-payment.spec.ts`** — C-tier (precision math).
7. **`react/CLAUDE.md`** (just the top section, "Versioning at a glance")
   — for context on which version we ship into.

That's roughly 90 minutes of reading. Don't skip the golden tests —
**they are the pattern you'll be copying for ~150 of your future tests**.

---

## Your first three PRs (do them in this order)

### PR 1 — Environment shakedown (Day 1, ~2 hours)

Goal: confirm your machine runs the existing tests green.

1. `cd react && npm install`
2. `npx playwright install chromium`
3. `npm run e2e` — the 6 existing tests should pass.
4. `npm run e2e:ui` — explore the trace viewer. You'll live in this UI.
5. Open a tiny throw-away PR fixing any typos / broken links you spot
   in the inventory or checklist while reading. Build the muscle of
   landing a PR + getting it reviewed.

**Done when:** all 6 existing tests pass on your machine, you have a
merged trivial PR on `main`.

### PR 2 — `window.__ff_store` exposure (Day 1–2, ~30 min code + tests)

The C-tier golden test (`debts-payment.spec.ts`) needs the Zustand
store exposed as a dev-mode global so tests can read derived state
the UI doesn't surface (e.g. `PaymentLogEntry.interest`).

**Task:** in `react/src/store.ts`, after the store is created, add:

```ts
if (import.meta.env.MODE !== 'production') {
  // Expose store to E2E tests (read-only oracle for derived state).
  // See react/e2e/REVIEW_CHECKLIST.md soft-gate "store-via-evaluate".
  (window as any).__ff_store = useStore;
}
```

Then make the C-tier golden test green:

```bash
npm run e2e -- debts-payment
```

You may also need to add a `recordDebtPayment(debtId, amount, date)`
action to the store if it doesn't exist by that name — check first; the
store has a similar action under a different name. Don't invent a new
math path, just expose the existing one.

**Done when:** `debts-payment.spec.ts` is green and the inventory's
🟣 DEBT-FC-002 status has flipped to ✅.

### PR 3 — Make the other two golden tests green (Day 2–3)

`transactions-create.spec.ts` (TXN-FC-001) and `networth-impact.spec.ts`
(NWRT-FC-002) should run green against the scaffolding as-is. If they
don't, the failures are 90 % likely to be **locator drift** — one of my
`getByLabel('Type')` calls doesn't match the real label, or the
`Account` select's option text changed.

**Don't change the test's intent to fix it.** Adjust the page-object
locator. If a locator can't be made stable, add a `data-testid` to
the component as a tiny separate prep PR.

**Done when:** both tests green; both inventory rows flipped 🟣 → ✅.

---

## After that: Phase 1 — Core CRUD (32 tests, ~6 weeks)

Work the inventory in this order:

| Order | Functional area | Tests | Why first |
|---:|---|---:|---|
| 1 | §1 TXN-FC (Transaction Creation) | 9 | Foundation everything else asserts against |
| 2 | §4 NWRT-FC (NetWorth Module Impact) | 6 | Cross-module assertion pattern |
| 3 | §2 TXN-EDIT-FC (Edit Propagation) | 6 | Builds on §1 |
| 4 | §3 TXN-DEL-FC (Deletion & Recovery) | 4 | Builds on §1 |
| 5 | §0 CON-E2E (finish Foundation) | 3 | Quick wins; covers routes + corrupt-state |

**One PR per functional area.** Aim for one PR every 3–5 working days.
A PR that takes longer than a week to land usually means the area was
too big and should have been split.

---

## How each PR should look

```
test(e2e): §1 TXN-FC — transaction creation suite (9 tests)

Covers TXN-FC-001 through TXN-FC-009 per inventory. All tests follow
the S-tier golden template; TXN-FC-003 and TXN-FC-008 extend to M-tier
patterns for the asset linkage + multi-currency assertions.

Inventory updated: TXN-FC-001..009 flipped 🟡 → ✅. Developed counter
9 → 18.
```

PR body checklist (lifted from `REVIEW_CHECKLIST.md` — paste into the
PR template):

- [ ] One PR == one functional area
- [ ] Every test starts with its Test Case ID in the name
- [ ] Inventory's Progress Tracker counter incremented
- [ ] All inventory rows for this PR flipped 🟡 → ✅
- [ ] No `await page.waitForTimeout(N)`
- [ ] No CSS selectors for primary assertions
- [ ] No localStorage mutation in test body
- [ ] `npm run e2e` green locally before pushing

---

## How to ask for help

| Situation | Action |
|---|---|
| You don't understand an inventory row's Expected | Comment on the inventory row in a PR; tag `<HANDLE>`. Don't guess. |
| A locator is genuinely unreachable | Open a prep PR adding `data-testid` to the component. ~15 min review turnaround. |
| A test seems to require a designer decision (Clarifications #1–#5 in the inventory) | Mark the test 🟠 and skip it. Don't write speculative tests. |
| The test fails intermittently | DO NOT add `waitForTimeout` to "fix" it. File the flake; we triage it together. |
| You hit a real app bug | Open a separate bug ticket. Don't fix app code in a test PR. |

**Cadence:** standup in `<CHANNEL>` daily, longer sync `<DAY/TIME>`,
PR reviews within 24 h of opening. If I haven't reviewed in 24 h,
DM me — I dropped it.

---

## Definition of done (overall engagement)

- All 163 inventory rows flipped to ✅ (or formally 🟠 with a product
  decision logged).
- Progress Tracker shows 0 🟡.
- `react/e2e/tests/` runs green in CI on every PR to `main`.
- Quarterly audit owners (TBD in inventory) acknowledge the inventory
  is current with shipped features.

---

## What success looks like at month 1

By end of Month 1, the Progress Tracker should read roughly:

- ✅ Developed: 6 + 32 (Phase 1) = **38** (23 % of total)
- Pace: ~8 tests / week sustained

If you're significantly behind that, **tell me early** — the rubric
hours in `TEST_CASE_INVENTORY.md` §Effort Estimate were estimated, not
measured. We recalibrate every 20 tests against your actual numbers.

---

Welcome aboard. Read the docs, run the tests, ship PR 1 today, ship
PR 2 by EOD tomorrow.

— <YOUR NAME>
