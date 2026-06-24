# E2E PR Review Checklist

> Every Playwright test PR is reviewed against this list. If a row is checked
> and the test still misbehaves, that's a scaffolding bug — file it against
> the scaffolding owner, not the test author.
>
> Reviewer time budget: **15 min / PR**. If a PR can't be reviewed in that
> window, it's too big — ask the author to split.

---

## Hard gates (any "no" blocks the PR)

- [ ] **One PR == one functional area** (e.g. all of §1 TXN-FC, or a coherent
      subset). PRs that mix unrelated areas get returned for splitting.
- [ ] **Every new test maps to a Test Case ID** listed in
      [`TEST_CASE_INVENTORY.md`](./TEST_CASE_INVENTORY.md). The test name
      starts with the ID — e.g. `TXN-FC-001 · creates an income …`.
- [ ] **`TEST_CASE_INVENTORY.md` is updated** in the same PR: the row's
      status flips from 🟡 to ✅ and the Progress Tracker counter
      increments. CI's freshness gate enforces this.
- [ ] **No `await page.waitForTimeout(N)`** anywhere. If you reach for it,
      your locator is wrong. Use `expect.poll`, web-first matchers, or
      `waitFor({ state })` on the right locator instead.
- [ ] **No `page.locator('css >> text=…')` for primary assertions.** Use
      `getByRole`, `getByLabel`, or `getByText` so the locator survives
      copy edits and i18n.
- [ ] **No direct localStorage mutation in the test body.** Seed data goes
      through `test.use({ seed })` only. If you need a new shape, extend
      `defaultSeed` / `seedWith()` in `fixtures/seed.ts`.
- [ ] **No commit-time `test.only` / `test.skip` / `test.fixme`.** CI
      lint catches `.only`; `.skip` is allowed but must reference a
      ticket in the surrounding comment.

## Soft gates (a "no" is a discussion, not a block)

- [ ] **Assertions read like the inventory's Expected Results section.**
      If a reviewer can't trace `expect(…).toBe(…)` back to the inventory
      row's "Expected" line, the test is testing the wrong thing.
- [ ] **One test == one Test Case ID.** Bundling two IDs into one test
      saves time today and costs an order of magnitude tomorrow when
      one of them flakes.
- [ ] **Money assertions use `parseMoney()` or `toBeCloseTo(_, 2)`.**
      String-matching formatted figures (`"$1,234.56"`) is fragile when
      the Money component switches to `1.2k` at scale.
- [ ] **Cross-module assertions read derived values from the UI, not the
      store.** The Zustand-via-`page.evaluate` escape hatch is reserved
      for state the UI does not surface (e.g. PaymentLogEntry breakdowns
      in DEBT-FC-002). If the UI shows it, assert on the UI.
- [ ] **Page Objects expose intent, not selectors.** A spec that reads
      `transactions.row('Salary').click()` is good; a spec that reads
      `page.locator('div.txn-row >> nth=2').click()` is a POM gap —
      add the helper to the POM rather than inlining the selector.
- [ ] **No reliance on default timeouts > 5 s.** If a wait genuinely
      needs longer than 5 s, the underlying behaviour is too slow and
      should be filed as a perf bug, not papered over with a longer timeout.

## Reviewer's first three actions

1. **Run the test locally (`npm run e2e -- <file>`)** before reading the
   diff. A test you can't run is a test that doesn't really exist.
2. **Read the inventory row** the PR claims to implement. Hold the test's
   Expected against the inventory's Expected — if the words don't match,
   one of them is wrong.
3. **Diff against the matching golden test** — TXN-FC-001 for S,
   NWRT-FC-002 for M, DEBT-FC-002 for C. Most lint-level feedback is
   "you drifted from the golden shape here".

## Common findings (copy-paste comments)

> **F-1 · `waitForTimeout` instead of web-first matcher.** Replace with
> `await expect(locator).toBeVisible()` or `expect.poll(…)`. Web-first
> matchers auto-retry until the condition holds or the timeout elapses;
> hard sleeps just hope.

> **F-2 · Selector via CSS class.** Tailwind class names are not stable
> contracts. Use `getByRole`, `getByLabel`, or `getByText`. If none fit,
> add a `data-testid` to the component as a separate prep PR.

> **F-3 · Test asserts on stored values via `page.evaluate` when the UI
> shows the value.** Reach for the store only when the UI lacks the
> surface — and document why, like DEBT-FC-002 does.

> **F-4 · Test bundles two Test Case IDs.** Please split. The inventory's
> 1-test-per-ID convention is what makes "we covered X" verifiable.

> **F-5 · Inventory row not updated.** Flip the status icon to ✅ and
> bump the Progress Tracker counter at the top of the file.

---

## Owner

This checklist is owned by the SDET lead. Propose changes via PR with
the label `qa-process`; significant changes require sign-off from the
quarterly-audit owners listed in `TEST_CASE_INVENTORY.md`.
