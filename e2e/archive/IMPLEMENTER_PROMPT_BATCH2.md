# Implementer Agent Prompt — Batch 2+ (post-Batch-1 learnings)

> Paste everything under the line into the coding agent. Batch 1 (§1 TXN-FC)
> is green; this prompt carries forward what we learned fixing it. The biggest
> lesson: **a lot of the inventory assumes behaviour the app does not have
> yet.** Verify before you assert.

---

## ROLE & STATE

You implement already-designed Playwright tests for the FinFlow consumer app
(`react/`). Current state in `react/e2e/TEST_CASE_INVENTORY.md`:

- ✅ 14 working (foundation CON-E2E-001..006; §1 TXN-FC-001/002/004/005/007/008/009; §7 DEBT-FC-002)
- 🟠 2 parked as `fixme` (NWRT-FC-002, TXN-FC-003 — app gaps)
- 🟡 147 not yet built

You work **one functional area per batch**, then STOP for review. You do NOT
commit — leave changes staged for the reviewer.

## REQUIRED READING (do not skip — these encode the Batch-1 fixes)

1. `react/e2e/TEST_CASE_INVENTORY.md` — the spec + Progress Tracker.
2. `react/e2e/REVIEW_CHECKLIST.md` — the grading rules.
3. `react/e2e/tests/transactions-create.spec.ts` — the WORKING S-tier pattern
   (note how it asserts through the UI and uses the store oracle only for
   non-surfaced state, each with a one-line reason).
4. `react/e2e/tests/debts-payment.spec.ts` — the WORKING C-tier pattern
   (store oracle for `paymentLog` math; UI assertion at page level).
5. `react/e2e/pages/TransactionFormModal.ts` — `selectByValueOrText` and why
   it scans options instead of calling `selectOption(value)` speculatively.

## ⛔ PRE-FLIGHT — CLASSIFY EVERY ROW BEFORE WRITING IT

This is the rule we learned the hard way. For each Test Case ID in your batch,
FIRST answer: **does the app actually implement this behaviour today?**

The app currently has **NO transaction → asset / NetWorth reflection**
(verified: `store.ts:upsertTransaction` never touches `Asset.value`; NetWorth
sums `Asset`/`Debt` rows, not transactions). So any row whose Expected says a
*transaction* changes an *asset balance, NetWorth total, or a linked goal* is
**blocked until Auto-Linking Phase A** (`docs/ROADMAP_AUTO_LINKING.md`).

For each row, write one of:
- **BUILD** — behaviour exists; implement and make it green.
- **FIXME** — behaviour is Phase-A / an app gap; write the test, mark
  `test.fixme(...)` with a one-line reason, leave the inventory row 🟠.
  NEVER weaken the assertion to pass on today's no-op behaviour.

Put this classification in your handoff note. A reviewer will check it first.

## HARD RULES (carried from Batch 1 — violations = rejection)

1. **One test == one inventory ID.** Name starts with the ID, e.g.
   `CON-E2E-0NN · [BDGT-FC-001] ...` (keep the `CON-E2E-` sequential prefix +
   bracketed design ID; next free number is **CON-E2E-017**).
2. **No `waitForTimeout`.** Web-first matchers / `expect.poll` only.
3. **No CSS-class selectors for assertions.** Use `getByRole`/`getByLabel`/
   `getByText`. **If a locator can't resolve, the app is probably missing an
   accessible name — fix it with a small a11y prep commit (a `role`, an
   `aria-label`, or a label↔control `htmlFor`/`id`), NOT a fragile
   `xpath`/`.last()` locator.** (That a11y gap is exactly what blocked Batch 1.)
4. **No `localStorage` mutation in the test body.** Seed via
   `test.use({ seed: seedWith({...}) })` only. Seeding is now idempotent, so
   records you add mid-test survive a reload — you may assert persistence.
5. **Assert through the UI by default.** Use the `window.__ff_store` oracle
   ONLY for state the UI does not render as text (counts, internal split
   fields), with a one-line reason. The oracle is available because the e2e
   server builds `--mode test`; it does not exist in real production.
6. **Match REAL option values.** Selects are native `<select>`. Category IDs
   live in `src/constants.ts` (e.g. `rent`, not `housing`; `investment_in`,
   not `savings`). Accounts come from `lib/accounts.ts:buildAccounts` — a
   `cash`-type asset is folded into generic "Cash" and is NOT selectable by
   name; seed `checking`/`savings` assets when you need a named account.
   When unsure, pass the bare visible name to `selectByValueOrText`.
7. **`selectOption(value)` retries until the test timeout on a bad value**
   (a 30 s hang). Use the POM helpers; never speculative-`selectOption`.

## RUNNING LOCALLY (avoid the stale-server trap)

`reuseExistingServer` is on locally, so a stale preview can mask your changes
to app code. When you touch anything under `src/`, force a fresh build+server:

```bash
cd react
CI=1 npx playwright test e2e/tests/<your-spec>.spec.ts --project=chromium --reporter=line
```

Read failures from `e2e/.results/**/error-context.md` (page snapshot + the
exact failing locator) before changing anything.

## BUILD ORDER — REVISED for what's actually implemented today

Batch 1 proved the reflection-dependent areas are largely blocked. Do the
self-contained, implemented areas first; defer reflection rows to post-Phase-A.

| Batch | Area | Why it's buildable now | Watch out for |
|---:|---|---|---|
| **2** | §5 Budgets (BDGT-FC-001..007) | budget "used" aggregates transactions by category/period — implemented | BDGT-FC-008 (surplus routing) is 🟠 Clarification #3 → fixme |
| 3 | §7 Debts remainder (DEBT-FC-001/003/004/005/006/007/008) | debt module + `recordDebtPayment` work (DEBT-FC-002 already green) | DEBT-FC-006/007 part-payment: verify `partChoice` is wired before asserting tenure/EMI |
| 4 | §3 TXN-DEL (001/002) + §8 Assets CRUD (ASSET-FC-001/002) | row delete/undo + asset CRUD are UI/store-level | TXN-DEL-003 (payment reversal) touches debt — verify; ASSET-FC-003 relink may be a gap |
| 5 | §6 Goals manual (GOAL-FC-001/002/008) | manual progress via GoalProgressModal is implemented | GOAL-FC-003/004/005/006/007 are auto-link/projection → 🟠 Phase B/E → fixme |

**Deferred to post-Phase-A (do NOT attempt as green): NWRT-FC-001/002, the
NetWorth/asset assertions inside TXN-EDIT-FC, and the auto-link GOAL-FC rows.**
Build them as `fixme` only if your batch covers them, with the Phase reference.

Start with **Batch 2 (§5 Budgets)**. Stop after it for review.

## NEW PAGE OBJECTS THIS BATCH NEEDS

- `BudgetsPage` already exists (navigation + add button). Extend it, and add a
  `BudgetFormModal` POM mirroring `TransactionFormModal` (role="dialog" via the
  shared Modal — already accessible after Batch 1; `getByLabel` for fields).
  If a Budget form field has no accessible name, add the label association in
  the same a11y style as the Batch-1 `Field` fix.

## SELF-CHECK BEFORE HANDOFF (paste the output)

```bash
cd react
CI=1 npx playwright test e2e/tests/<your-spec>.spec.ts --project=chromium  # all green (fixme allowed)
npx tsc --noEmit                                                            # clean
```

## INVENTORY BOOKKEEPING (same diff)

- Flip each BUILD row 🟡 → ✅; mark each FIXME row 🟠 with a one-line reason.
- Update the Progress Tracker counts + percentages so they still sum to 163.

## HANDOFF FORMAT (end the batch with exactly this, then STOP)

```
BATCH <n> COMPLETE — §<area>

Classification:
  BUILD  : <IDs>
  FIXME  : <IDs + reason: Phase A/B/E | clarification # | app gap>
Tests added:   <IDs>
POM/app changes: <files, one line each — call out any a11y prep commit>
Self-check:    e2e <pass/fail, N passed / M fixme> · tsc <clean>
Inventory:     Developed <old> → <new> ; Blocked <old> → <new>

Diff staged for review. Awaiting approval before Batch <n+1>.
```

## WHAT NOT TO DO

- Don't assert reflection behaviour that doesn't exist (the Batch-1 trap).
- Don't fix app bugs beyond small a11y/test-hook prep needed to locate
  elements; file anything larger and `fixme` the affected test.
- Don't add dependencies. Don't touch `package.json`, CI, or the determinism
  fixtures without flagging it.
- Don't commit. Don't batch more than one area before a review gate.
