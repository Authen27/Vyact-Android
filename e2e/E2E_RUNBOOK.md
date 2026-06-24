# E2E Runbook — read this before writing or running tests

One page of hard-won setup truth so you don't lose hours rediscovering it.
Pairs with `REVIEW_CHECKLIST.md` (how tests are graded) and
`TEST_CASE_INVENTORY.md` (what to build).

## Canonical base

- **`main` is the canonical base.** It already contains: the a11y fixes
  (`Modal` `role="dialog"`, `Field` `htmlFor`/`id`), the `selectByValueOrText`
  POM helper, the `--mode test` e2e build, the §1 TXN-FC suite, §7 DEBT-FC-002,
  and §5 BDGT-FC. Branch from `main`; do not resurrect old feature branches.
- **Commit early and often.** This workspace has reverted uncommitted working-
  tree edits mid-session. If a file matters, commit it — uncommitted POMs and
  specs have been silently wiped here. One commit per coherent step.

## How to run (and why the flags matter)

```bash
cd react
CI=1 npx playwright test e2e/tests/<spec>.spec.ts --project=chromium --reporter=line
```

- **`CI=1`** disables `reuseExistingServer`, forcing a fresh build+serve.
  Without it, a stale preview can mask your `src/` changes.
- The webServer builds with **`--mode test`** (see `playwright.config.ts`).
  That sets `import.meta.env.MODE='test'`, which is what exposes
  `window.__ff_store` (guarded by `MODE !== 'production'` in `store.ts`).
  A plain prod build hides the oracle and every store-read assertion returns
  `-1`/undefined.
- Read failures from `e2e/.results/**/error-context.md` — it has the page
  snapshot and the exact failing locator. Look before you edit.

## Gotchas that have already cost time

1. **`selectOption(value)` does NOT fail fast.** On a non-matching value it
   retries until the 30 s test timeout. NEVER call it speculatively in a
   try/catch cascade (the old `flexibleSelect` trap). Use the POM
   `selectByValueOrText`, which scans the rendered `<option>`s and matches in
   JS (instant, clear error).

2. **`getByLabel` is a substring match by default → collisions.** Example: the
   budget **Period** field's hint contains the word "limit", so
   `getByLabel('Limit')` matched both Limit and Period. Use
   `getByLabel('X', { exact: true })` for plain-word labels; anchor with a
   regex (`/^Period/`) when the accessible name carries a hint suffix.

3. **The app first-run DEMO seed fires when transactions + budgets + members
   are ALL empty** (`store.ts`). It ships sample data (e.g. a `transport $200`
   budget) that pollutes assertions. If a test needs an empty entity, seed a
   throwaway **member** so the household is "non-empty" and the demo stays off.

4. **Accounts:** a `cash`-type asset is folded into the generic "Cash" option
   (`lib/accounts.ts`); seed `checking`/`savings` to get a named, selectable
   account. Category IDs are in `src/constants.ts` (`rent` not `housing`,
   `investment_in` not `savings`).

5. **No transaction → asset / NetWorth reflection exists** (it's Auto-Linking
   Phase A). Don't assert that recording/editing a transaction moves an asset
   balance or NetWorth total — `test.fixme` those with the Phase-A note. Verify
   a behaviour exists in the app before asserting it; never weaken an assertion
   just to go green.

## Store oracle — use sparingly

`window.__ff_store.getState()` is for reading state the UI does not surface as
text (a record count, a `paymentLog` interest/principal split). If the value
is on screen, assert on the UI instead. Always leave a one-line reason when you
reach for the oracle.

## Definition of done for a batch

- All BUILD tests green on `CI=1 … --project=chromium`; FIXME tests skipped
  with a reason.
- `npx tsc --noEmit` clean.
- `TEST_CASE_INVENTORY.md` Progress Tracker + summary row updated (counts sum
  to 163).
- Committed to `main` (or a branch off `main`), with the handoff block from
  `IMPLEMENTER_PROMPT` filled in.
