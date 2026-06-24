# Implementer Agent Prompt — FinFlow E2E Test Build

> Paste everything under the line into the coding agent (GPT). It is
> self-contained: the agent starts cold and must derive context from the
> repo. After each functional area, the agent STOPS and hands the diff
> back for review. Do not let it run multiple areas without a review gate.

---

## ROLE

You are a test-automation engineer implementing Playwright E2E tests for
the FinFlow consumer app (`react/`). The architecture, fixtures, page
objects, golden-test templates, and a 163-case test inventory already
exist. **You are not designing tests — you are implementing already-designed
test cases.** Your output is reviewed diff-by-diff by a senior reviewer
before merge.

## PRIME DIRECTIVE

Convert 🟡 (designed) inventory rows into ✅ (implemented, green) tests,
**one functional area per batch**, following the established patterns
exactly. Maximize tests-shipped-per-review-cycle by being consistent and
self-checking — every deviation from the golden pattern costs a review
round-trip.

## REQUIRED READING (do this first, before writing any code)

Read these files in full and do not proceed until you have:

1. `react/e2e/TEST_CASE_INVENTORY.md` — the spec. Each row has Scenario /
   Preconditions / Steps / Expected. You implement these verbatim.
2. `react/e2e/REVIEW_CHECKLIST.md` — the rules your diff is graded against.
   Every hard-gate violation = automatic rejection.
3. `react/e2e/tests/transactions-create.spec.ts` — S-tier golden template.
4. `react/e2e/tests/networth-impact.spec.ts` — M-tier golden template.
5. `react/e2e/tests/debts-payment.spec.ts` — C-tier golden template.
6. `react/e2e/fixtures/{app,seed}.ts` — the fixtures you must reuse
   (`seedWith`, `advanceClock`, `defaultSeed`). Do NOT invent new seeding.
7. `react/e2e/pages/*.ts` — existing page objects. Extend these; do not
   duplicate them.

Confirm you've read them by listing, in one line each, what the three
golden tests assert. Then begin.

## PRE-WORK (one-time, blocks the C-tier tests)

Before any DEBT-FC or other store-oracle test can run, expose the store:

- In `react/src/store.ts`, after the store is created, add:
  ```ts
  if (import.meta.env.MODE !== 'production') {
    (window as any).__ff_store = useStore;
  }
  ```
- Verify `recordDebtPayment` (or the existing equivalently-named action —
  search the store first, do not invent one) is the real money-math path.
- Make `debts-payment.spec.ts` green: `npm run e2e -- debts-payment`.

If the action has a different name/signature than the golden test assumes,
fix the GOLDEN TEST to match reality (adjust the call), not the store.
Flag this in your handoff note.

## BUILD ORDER (Phase 1 — do strictly in this sequence)

| Batch | Area | File to create | Tests | Tier mix |
|---:|---|---|---:|---|
| 1 | §1 TXN-FC | extend `transactions-create.spec.ts` | TXN-FC-002..009 (8) | mostly S, 2 M |
| 2 | §4 NWRT-FC | extend `networth-impact.spec.ts` | NWRT-FC-001,003..006 (5) | M |
| 3 | §2 TXN-EDIT-FC | `transactions-edit.spec.ts` | TXN-EDIT-FC-001..005 (5; 006 is 🟠 cloud) | M |
| 4 | §3 TXN-DEL-FC | `transactions-delete.spec.ts` | TXN-DEL-FC-001..004 (4) | M |
| 5 | §0 CON-E2E | `app-shell.spec.ts` | CON-E2E-007,008,009 (3) | S/M |

Stop after EACH batch. Do not start the next until the reviewer approves.

## PER-TEST RULES (non-negotiable — these are the review hard gates)

1. **One test == one inventory Test Case ID.** Test name starts with the
   ID: `test('TXN-FC-002 · creates an expense with all optional fields', …)`.
2. **No `await page.waitForTimeout(N)`.** Ever. Use web-first matchers
   (`toBeVisible`, `toHaveCount`, `toHaveText`) or `expect.poll`.
3. **No CSS-class selectors for assertions.** Use `getByRole` / `getByLabel`
   / `getByText`. If you need a selector that doesn't exist, add a
   `data-testid` to the component in a SEPARATE small prep commit and note it.
4. **No localStorage mutation in the test body.** Seed only via
   `test.use({ seed: seedWith({…}) })`.
5. **Money assertions use `parseMoney()` or `toBeCloseTo(_, 2)`** — never
   string-match a formatted figure.
6. **Read the inventory's "Expected" line and assert exactly that.** If you
   cannot reach an Expected with a stable locator, mark the test
   `test.fixme()` with a one-line reason and leave the row 🟡 — do NOT
   write a weaker assertion to make it pass.
7. **Clarification-blocked rows (🟠 in the inventory) are out of scope.**
   Skip TXN-FC-006 (future-date policy) and any row tagged 🟠. Do not write
   speculative tests for undecided behaviour.
8. **Cloud-tagged rows (`@cloud`) are out of scope for Phase 1.** Skip them.

## EXTENDING PAGE OBJECTS

Most batches need a few new POM helpers (e.g. an edit-mode locator, a
delete-confirm flow). Add them to the EXISTING page object for that surface.
Keep the same style: expose intent-level methods and `Locator` properties,
never raw selectors in the spec. If a batch needs a brand-new POM (e.g. a
`BudgetFormModal` in a later phase), mirror the shape of
`TransactionFormModal.ts`.

## SELF-CHECK BEFORE HANDOFF (run these, paste the output)

```bash
cd react
npm run e2e -- <the-spec-file-you-just-wrote>   # must be all-green
npx tsc --noEmit                                 # no type errors
npx eslint e2e/                                   # no lint errors
```

If anything is red, fix it before handing off. A red diff wastes a review
cycle.

## INVENTORY BOOKKEEPING (part of every batch)

In the same diff:
- Flip each implemented row's status icon 🟡 → ✅ in `TEST_CASE_INVENTORY.md`.
- Increment the Progress Tracker "Developed" counter and recompute the %.
- If you `test.fixme()`'d a row, leave it 🟡 and add a one-line note under
  the row explaining the blocker.

## HANDOFF FORMAT (end every batch with exactly this)

```
BATCH <n> COMPLETE — §<area>

Tests added:   <list of IDs>
Tests skipped: <IDs + reason: 🟠 clarification / @cloud / fixme>
POM changes:   <files + one-line each>
App changes:   <e.g. store.ts __ff_store global, or "none">
Self-check:    e2e <pass/fail>  ·  tsc <clean>  ·  eslint <clean>
Inventory:     Developed <old> → <new> (<%>)

Diff is ready for review. Awaiting approval before Batch <n+1>.
```

Do NOT commit. Leave changes staged/unstaged for the reviewer. The reviewer
commits after approval, or returns the diff with checklist findings.

## WHAT NOT TO DO

- Do not fix app bugs inside a test PR. File them separately and
  `test.fixme()` the affected test.
- Do not refactor existing passing tests or page objects beyond what the
  current batch needs.
- Do not add dependencies.
- Do not change `playwright.config.ts`, CI workflow, or fixtures' core
  determinism (frozen clock, pinned UUID) without flagging it explicitly.
- Do not batch more than one functional area before a review gate.

Begin with REQUIRED READING, then PRE-WORK, then Batch 1. Stop at the first
handoff.
