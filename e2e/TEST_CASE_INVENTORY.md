# Vyact — Consumer Test Case Inventory

> **Authoritative source of truth for functional QA automation.**
> Scope: `react/` consumer app (v7.3.1). Framework: Playwright E2E.
> Local-only mode is the default execution environment; cloud-mode tests are
> tagged `@cloud` and require Supabase env vars.

---

## Maintenance Rules

1. **Every PR that ships user-visible behaviour must update this file.**
   - New feature → add test ID(s) under the relevant functional area.
   - Bug fix → add a `*-REG-NNN` regression entry citing the issue/PR.
   - Removed feature → mark the test ID `DEPRECATED <version>` (keep the row).
2. **Test IDs are immutable.** Never reuse a number, even after deprecation.
3. **CI gate:** the lint job fails if `react/e2e/TEST_CASE_INVENTORY.md` is
   older than any modified file under `react/src/` in the same PR (configured
   in `.github/workflows/ci.yml`).
4. **Quarterly audit:** owners listed at the bottom of this file walk the
   inventory against shipped features and the changelog.

---

## Status Legend

| Symbol | Meaning |
|---|---|
| ✅ | Implemented & passing in CI |
| 🟡 | Designed, awaiting implementation |
| 🟠 | Blocked on a designer clarification (see §Clarifications) |
| 🔴 | Failing / quarantined — must be fixed before next release |
| ⛔ | Deprecated |

---

## Progress Tracker

> Update these counters in the same PR that lands or removes a test.
> CI verifies the table sums match the body — drift will fail the lint job.

| Metric | Count | % of Total |
|---|---:|---:|
| ✅ **Developed (green in CI)** | **80** | **45.2 %** |
| 🟡 Designed (awaiting build) | 87 | 49.2 % |
| 🟠 Blocked (app gap — Auto-Linking Phase A/B/C/D) | 10 | 5.7 % |
| 🔴 Failing / quarantined | 0 | 0.0 % |
| ⛔ Deprecated | 0 | — |
| **Total in scope** | **177** | 100 % |

**Developed (80):** foundation CON-E2E-001..008/010/011; §1 TXN-FC-001/002/003/004/005/007/008/009/010/011/012/013;
§2 TXN-EDIT-FC-003; §3 TXN-DEL-FC-001/002; §4 NWRT-FC-003/004; §5 BDGT-FC-001/002/004/005/006/007;
§7 DEBT-FC-001/002/003/006/007/009; §8 ASSET-FC-001/002/004; §12 RPT-FC-001/002/003; §13 PULSE-FC-005/006; §14 AUTH-FC-010/012;
§15 PROFILE-FC-001/002/003/004/005/006/007/008; §18 BACKUP-FC-001/002/003/004/005; §19 SEARCH-FC-001/002/003/004;
§20 ONB-FC-002/003/004/005; §21 PRIV-FC-001/002; §23 FX-FC-001/005; §24 A11Y-FC-001/004; §25 RESP-FC-001/002/004/005.

**Blocked (10):** all roll up to Auto-Linking phases in
`docs/ROADMAP_AUTO_LINKING.md` plus two app-gap items surfaced in CI —
- **NWRT-FC-001 / -002 / -005 / -006** — need Auto-Linking **Phase A**
  (verified: `upsertTransaction` does not mutate `Asset.value`; no
  transaction→asset reflection exists yet). NWRT-FC-002 is `fixme` in CI;
  the other three carry the same dependency and are tagged 🟠 for
  consistency.
- **GOAL-FC-003 / -004** — Auto-Linking **Phase B** (income→goal credit).
- **BDGT-FC-008** — Auto-Linking **Phase C** (budget surplus routing).
- **SPLIT-FC-005 / -006, TXN-DEL-FC-004** — Auto-Linking **Phase D**
  (split settlement + anchor-deletion cascade).
- **TXN-FC-006** (future-date policy) — still awaits a product decision.
- **BDGT-FC-003** (threshold notification) — the `budget_threshold` notif
  type exists but `DEFAULT_PREFS.budget_threshold = false`
  (`react/src/lib/notifications.ts`); the test must enable the pref as a
  precondition and assert against the in-app NotificationCenter only
  (`showWebPush` is wired for `missed_payment` + `goal_milestone` only,
  per `react/src/store.ts`).

**App fixes shipped to unblock testing / latest inventory audit:**
- `Modal.tsx` — `role="dialog"` + `aria-modal` + `aria-labelledby` (a11y +
  `getByRole('dialog')`).
- `Input.tsx` `Field` — `<label htmlFor>`/`id` association (a11y + `getByLabel`).
- `playwright.config.ts` — e2e server builds in `--mode test` so the dev-only
  `window.__vt_store` oracle is available (never in real production). The
  legacy `window.__ff_store` alias is still exposed for in-flight specs
  via the localStorage-compat shim in `react/src/store.ts` and will be
  retired once every spec migrates to `__vt_store`.
- `seed.ts` — idempotent seeding (records added mid-test now survive reload);
  `E2E Checking` is a `checking` asset so it is a selectable linked account.
- `__e2e__ErrorTest.tsx` + `ErrorBoundary.tsx` — deterministic throw/recover
  so CON-E2E-005 "Try Again" actually recovers.
- `TransactionFormModal.tsx` — the transaction time input is now app-owned
  text entry (`hh:mm` + `AM/PM`) instead of the older clock popover; future
  tests should assert the current text/select surface, not a dial UI.
- `Sidebar.tsx` / `Settings.tsx` — sensitive export/reset affordances now live
  under Settings; the main drawer should no longer be used as the source of
  truth for those actions.
- `constants.ts` / `Sidebar.tsx` — `Accounts` and `Insights` labels now come
  from explicit locale strings, fixing the lowercase fallback-key rendering in
  the drawer.

**Burn-down target:** see §Effort Estimate at the bottom of this file for the
phased delivery plan against this counter.

---

## Checkpoint Analysis — 2026-06-03

This checkpoint re-audited the inventory against the shipped `react/` app
before adding more coverage. The rule for subsequent work is strict: implement
only the rows whose current UI/store contract is observable today; rewrite or
hold rows that still describe roadmap-era behaviour.

- **Keep as future-facing blockers:** Auto-Linking rows, cloud sync/conflict
  rows, and other cases that still map to intended product behaviour but do
  not yet have a shipped surface.
- **Rewrite to shipped behaviour before implementing:** localStorage-corruption
  recovery, profile locale/date coverage, household-type expectations,
  backup/portability, search/filter, and shortcut rows were all tightened to
  match the current UI.
- **Do not implement blindly from old wording:** there is no Settings import
  flow, no visible Settings resync control, no modal focus trap/return-focus
  logic, and no toast `aria-live` region in the current build.
- **Recent UI drift to honour in new specs:** the transaction modal no longer
  exposes a clock picker; time entry is `hh:mm` plus an `AM/PM` select. The
  sidebar no longer surfaces Export / Clear shortcuts, and drawer assertions
  should expect title-cased `Accounts` / `Insights` labels from locale strings.
- **Candidate additions once capacity opens:** quota-exceeded backup warning,
  cloud empty-response warning toast, and explicit clipboard-backup assertions
  are all now visible enough to justify future IDs if needed.
- **Count update after re-audit:** `80` rows are implemented and `97` remain
  open. Of the open backlog, `87` are implementation-ready and `10` are still
  blocked on missing product surface. `16` rows were rewritten in this
  checkpoint; `6` of those remain open after the current implementation pass.

### Rewritten rows in this checkpoint (16)

- `CON-E2E-008`
- `AUTH-FC-010`, `AUTH-FC-012`
- `PROFILE-FC-003`, `PROFILE-FC-004`
- `SYNC-FC-005`
- `BACKUP-FC-001`..`BACKUP-FC-005`
- `SEARCH-FC-002`, `SEARCH-FC-003`
- `A11Y-FC-001`, `A11Y-FC-002`, `A11Y-FC-003`

### Future-gap split

- **Blocked by shipped app behaviour / missing product surface (14 IDs):**
  `TXN-FC-006`, `TXN-DEL-FC-004`, `NWRT-FC-001`, `NWRT-FC-002`,
  `NWRT-FC-005`, `NWRT-FC-006`, `BDGT-FC-003`, `BDGT-FC-008`,
  `GOAL-FC-003`, `GOAL-FC-004`, `SPLIT-FC-005`, `SPLIT-FC-006`,
  `A11Y-FC-002`, `A11Y-FC-003`.
  (`TXN-FC-003` was unblocked in v7.0.3 — see Track Picker rows below.)
- **Blocked primarily by cloud/runtime harness rather than local UI shape (18 IDs):**
  `AUTH-FC-001`..`AUTH-FC-009`, `AUTH-FC-011`, `HH-FC-005`, `HH-FC-006`,
  `SYNC-FC-001`..`SYNC-FC-006`.
- **Local-only but still unimplemented (adjacent next-wave candidates):**
  `ONB-FC-001`, `RESP-FC-003`, `PRIV-FC-003`.

---

## Summary

| # | Functional Area | Prefix | Implemented | Designed | Total |
|---:|---|---|---:|---:|---:|
| 0 | Foundation & Smoke | CON-E2E | 9 | 1 | 10 |
| 1 | Transaction Creation & Validation | TXN-FC | 12 | 1 | 13 |
| 2 | Transaction Edit Propagation | TXN-EDIT-FC | 1 | 5 | 6 |
| 3 | Transaction Deletion & Recovery | TXN-DEL-FC | 2 | 2 | 4 |
| 4 | NetWorth Module Impact | NWRT-FC | 2 | 4 | 6 |
| 5 | Budgets Module | BDGT-FC | 6 | 2 | 8 |
| 6 | Goals Tracking | GOAL-FC | 0 | 8 | 8 |
| 7 | Debt Payment Cascading | DEBT-FC | 6 | 3 | 9 |
| 8 | Asset Management | ASSET-FC | 3 | 2 | 5 |
| 9 | Split Payments | SPLIT-FC | 0 | 6 | 6 |
| 10 | Recurring Transactions | RECUR-FC | 0 | 7 | 7 |
| 11 | Notifications System | NOTIF-FC | 0 | 6 | 6 |
| 12 | Reports & Analytics | RPT-FC | 3 | 3 | 6 |
| 13 | Family Pulse Score™ | PULSE-FC | 2 | 4 | 6 |
| 14 | Login, Registration & Session | AUTH-FC | 2 | 10 | 12 |
| 15 | Account Details & Profile | PROFILE-FC | 8 | 0 | 8 |
| 16 | Multi-Household & Members | HH-FC | 0 | 6 | 6 |
| 17 | Cloud Sync & Conflict Resolution | SYNC-FC | 0 | 6 | 6 |
| 18 | Backup & Data Portability | BACKUP-FC | 5 | 0 | 5 |
| 19 | Search & Filter | SEARCH-FC | 4 | 0 | 4 |
| 20 | Onboarding & Templates | ONB-FC | 4 | 1 | 5 |
| 21 | Privacy / Excluded Transactions | PRIV-FC | 2 | 1 | 3 |
| 22 | Investment Auto-Update | INV-FC | 0 | 3 | 3 |
| 23 | Multi-Currency & FX | FX-FC | 2 | 3 | 5 |
| 24 | Keyboard Shortcuts & Accessibility | A11Y-FC | 2 | 3 | 5 |
| 25 | Responsive & Mobile Layout | RESP-FC | 4 | 1 | 5 |
| 26 | Performance & Large Datasets | PERF-FC | 0 | 4 | 4 |
| 27 | Error Resilience & Edge Cases | ERR-FC | 1 | 5 | 6 |
|   | **TOTAL** | | **80** | **97** | **177** |

> CON-E2E-005 (error boundary) is listed under §27 (Error Resilience) but
> retains its original ID. Foundation §0 therefore excludes that recovery test
> from its local count even though the overall inventory total includes it.

---

# §0 · Foundation & Smoke (CON-E2E)

### ✅ CON-E2E-001 — Boots into dashboard in local-only mode
- **File**: `react/e2e/tests/smoke.spec.ts`
- **Scenario**: No Supabase env vars; visiting `/` should land on dashboard.
- **Steps**: `goto('/')` → expect redirect to `/dashboard`.
- **Expected**: Title contains "Vyact" (post-v7.0.0 rebrand); `dashboard.logoLink` visible.

### ✅ CON-E2E-002 — Does not render cloud auth screen in local-only mode
- **File**: `smoke.spec.ts`
- **Steps**: `goto('/')`.
- **Expected**: URL never matches `/auth/`.

### ✅ CON-E2E-003 — Seeded transactions are visible
- **File**: `smoke.spec.ts`
- **Preconditions**: `defaultSeed` injected.
- **Expected**: Rows "E2E Salary", "E2E Rent", "E2E Grocery" visible on Transactions.

### ✅ CON-E2E-004 — Seeded data survives page reload (persistence guard)
- **File**: `smoke.spec.ts`
- **Steps**: Open Transactions → reload → re-assert seeded rows.
- **Why**: Regression guard for the v6.4 "data lost on refresh" class of bug.

### ✅ CON-E2E-006 — Recharts lazy-loads only on chart pages
- **File**: `code-splitting.spec.ts`
- **Steps**: Visit `/transactions` (no recharts) → visit `/dashboard` (recharts loads).

### ✅ CON-E2E-007 — Every primary route renders without a console error
- **Scenario**: Smoke each top-level page in the sidebar and every routed
  page reachable from auth/legal flows.
- **Steps**: Loop through `/dashboard`, `/transactions`, `/budgets`, `/goals`,
  `/splits`, `/debts`, `/networth`, `/reports`, `/recurring`, `/planner`,
  `/chat`, `/insights`, `/households`, `/settings`, `/help`. Legal pages
  (`/privacy`, `/cookies`, `/terms`) are covered by CON-E2E-011.
- **Expected**: Each route mounts; `page.on('pageerror')` captures nothing;
  `console.error` only fires for known-allowlisted messages.

### ✅ CON-E2E-008 — App tolerates corrupt localStorage payload
- **Scenario**: Pre-seed the primary `vt_*` keys with malformed JSON.
- **Expected**: App boots without crashing and falls back to clean defaults /
  empty state for the malformed entity. Current shipped behaviour silently
  ignores the bad blob; it does **not** surface the older restore toast or
  preserve a `vt_corrupt_backup_<ts>` snapshot.
- **See also**: CON-E2E-010 covers the legacy `ff_*` read-fallback path.

### 🟡 CON-E2E-009 — Initial dashboard render within performance budget
- **Scenario**: With `defaultSeed`, dashboard FCP < 1500 ms on CI hardware.
- **Tooling**: `page.evaluate(() => performance.getEntriesByType('paint'))`.

### ✅ CON-E2E-010 — Legacy `ff_*` localStorage payload boots successfully
- **Scenario**: Pre-seed only `ff_store`, `ff_profile`, `ff_transactions` (no
  `vt_*` keys present) to simulate an upgrade from a pre-v7.0.0 install.
- **Expected**: App reads via the localStorage-compat shim
  (`react/src/lib/localStorageCompat.ts`), seeded entities are visible, and
  subsequent writes land under `vt_*`. Regression guard for the 90-day
  brand-migration window.

### ✅ CON-E2E-011 — Legal pages render and are linkable
- **Scenario**: Direct navigation to `/privacy`, `/cookies`, `/terms`.
- **Expected**: Each page mounts standalone (without auth), the document
  title reflects the page, and the footer link back to `/dashboard` works.

---

# §1 · Transaction Creation & Validation (TXN-FC)

### ✅ TXN-FC-001 — Create income with minimum required fields
- **Scenario**: `type='income'`, amount, date, description only.
- **Expected**: Row visible with green income chip; `currency = profile.baseCurrency`.

### ✅ TXN-FC-002 — Create expense with full optional set
- **Scenario**: Category, note, paymentMethod, memberId all populated.
- **Expected**: All fields round-trip through reload; paymentMethod chip rendered.

### ✅ TXN-FC-003 — Transfer track writes the paired transfer rows *(v7.0.3)*
- **Preconditions**: Feature flag `vt_feature_track_picker = '1'` set in
  localStorage. Assets `Checking` ($10k) and `Savings` ($5k).
- **Steps**: Open Add Transaction → pick **Transfer** track → amount $2k →
  From `Checking`, To `Savings` → Save.
**Expected**: Two paired transactions are written by `upsertTransaction` —
an `expense` from the source account and an `income` to the destination,
both with `category = 'transfer'` and a shared `__tg:<groupId>` marker in
`note`.

### ✅ TXN-FC-004 — Create investment transaction with asset link
- **Preconditions**: Feature flag `vt_feature_track_picker = '1'`. An
  investment-type asset exists (e.g. `Brokerage`).
- **Scenario**: Pick **Investment** track → category `Buy / Contribute` →
  From `Cash`, Vehicle `Brokerage`.
- **Expected**: `Transaction.type = 'investment'`,
  `Transaction.linkedToAssetId` references the brokerage asset (rides on
  `extras` JSON in the cloud row, no schema migration). If asset
  auto-update is enabled (Auto-Linking Phase A), the asset value
  increases by the invested amount; otherwise the row stands alone.

### ✅ TXN-FC-005 — Reject non-positive / non-numeric amount
- **Steps**: Submit amount of `-100`, `0`, `abc`.
- **Expected**: Inline validation error; form does not submit; no row appended.

### 🟡 TXN-FC-006 — Future-date policy 🟠
- **Steps**: Enter date one year in the future.
- **Expected**: *Pending designer decision — see Clarification #4.* Document the
  resolved policy in this row before implementation.

### ✅ TXN-FC-007 — Description/category preserve Unicode and emoji
- **Steps**: Description = `Rent @ 123 Main St 🏠 — €1200`.
- **Expected**: Stored byte-for-byte; searchable; rendered correctly on row.

### ✅ TXN-FC-008 — Multi-currency entry stores original currency
- **Steps**: With `baseCurrency='USD'`, create expense in `EUR`.
- **Expected**: `Transaction.currency='EUR'`; display shows €; NetWorth/Reports
  convert via `exchangeRates` (see §23 FX-FC).

### ✅ TXN-FC-009 — Rapid double-submit yields a single transaction
- **Scenario**: User double-clicks the submit button.
- **Expected**: Exactly one row created; UUID pinning + idempotent submit.

### ✅ TXN-FC-010 — Track picker gates the category list *(v7.0.3)*
- **Preconditions**: `vt_feature_track_picker = '1'`.
- **Steps**: Open Add Transaction. Assert `data-testid="track-picker"` is
  visible with all four `track-pick-{expense|income|transfer|investment}`
  buttons. Tap the **Investment** card.
- **Expected**: Picker is replaced by the form. The Track field shows
  `Investment` (locked, with a *Change* affordance). The Category
  `<select>` lists exactly the five `INVESTMENT_CATEGORIES`
  (`investment_in`, `investment_out`, `dividend`, `capital_gain`,
  `rebalance`) — neither `food` nor `salary` appears. Re-opening and
  picking **Transfer** hides the Category field entirely (transfer rows
  hard-code `category: 'transfer'`).
- **Tier**: S — ~3 h.

### ✅ TXN-FC-011 — Edit mode skips the track picker *(v7.0.3)*
- **Preconditions**: `vt_feature_track_picker = '1'`. An existing income
  transaction.
- **Steps**: Click the row to open Edit Transaction.
- **Expected**: The picker (`data-testid="track-picker"`) is **not**
  rendered. The form opens directly with the Track field locked to
  `Income` and **no** *Change* affordance (an edit cannot change the
  track of a stored row). Cancelling closes the modal without writing.
- **Tier**: S — ~3 h.

### ✅ TXN-FC-012 — Track keyboard shortcuts 1–4 *(v7.0.3)*
- **Preconditions**: `vt_feature_track_picker = '1'`.
- **Steps**: Open Add Transaction. With the picker focused, press `1`,
  then cancel; reopen and press `2`; reopen `3`; reopen `4`.
**Expected**: Each numeric key advances directly to the corresponding
track form (`1`→Spend, `2`→Income, `3`→Transfer, `4`→Investment) —
same outcome as clicking the matching `track-pick-*` card. `Esc`
closes the modal at any stage.
- **Tier**: S — ~3 h.

### ✅ TXN-FC-013 — Text time entry persists and sorts by latest timestamp *(v7.3.1)*
- **Scenario**: Open Add Transaction and enter time via the shipped text
  surface: `hh:mm` plus an `AM/PM` select.
- **Steps**: Create two same-day transactions with distinct times (for example
  `09:15 AM` and `06:45 PM`). Reload the page.
- **Expected**: Both rows persist with the intended times, validation rejects
  malformed text, and the later timestamp renders above the earlier one on the
  Transactions page. Specs must assert the current text/select input, not the
  removed clock popover.

---

# §2 · Transaction Edit Propagation (TXN-EDIT-FC)

### 🟡 TXN-EDIT-FC-001 — Amount edit recomputes NetWorth
- **Preconditions**: Expense $500; NetWorth $9,500 (from $10k asset).
- **Steps**: Edit amount → $800.
- **Expected**: NetWorth → $9,200; dashboard charts repaint.

### 🟡 TXN-EDIT-FC-002 — Type flip (expense → income) cascades correctly
- **Steps**: Toggle type on an existing $500 expense.
- **Expected**: NetWorth swings by $1,000 (−$500 expense removed, +$500 income added);
  badge colour flips; budget for the original category releases its $500.

### ✅ TXN-EDIT-FC-003 — Date edit moves transaction between budget periods
- **Preconditions**: Food budget $300/month; expense $100 on 2026-05-15.
- **Steps**: Edit date to 2026-06-15.
- **Expected**: May budget "used" decreases by $100; June increases by $100.

### 🟡 TXN-EDIT-FC-004 — Deleting an auto-generated debt-payment transaction restores debt balance
- **Preconditions**: Transaction created by `recordDebtPayment` in
  `react/src/store.ts`; debt `paymentLog` includes its id.
- **Steps**: Delete the expense row.
- **Expected**: Entry removed from `paymentLog`; debt balance recomputed
  from the remaining log; no orphaned `linkedDebtId` on any row.
- **Note**: There is no manual "unlink" UI — debt-payment transactions are
  exclusively automation outputs. Test the deletion cascade, not an unlink
  affordance.

### 🟡 TXN-EDIT-FC-005 — Member reassignment updates per-member aggregations
- **Preconditions**: Family household with Alice + Bob.
- **Steps**: Edit `memberId` Alice → Bob on a $500 expense.
- **Expected**: Alice's "spent this month" −$500; Bob's +$500; Pulse Score
  components recompute.

### 🟡 TXN-EDIT-FC-006 — Edit is conflict-safe with concurrent cloud update 🟢`@cloud`
- **Scenario**: Same transaction edited on Device A and Device B simultaneously.
- **Expected**: Adapter surfaces a conflict toast (TD-03 optimistic-concurrency);
  user can choose "Use mine" / "Use theirs"; no silent overwrite.

---

# §3 · Transaction Deletion & Recovery (TXN-DEL-FC)

### ✅ TXN-DEL-FC-001 — Hard delete via row menu, confirm dialog cancels safely
- **Steps**: Delete row → cancel the confirm; re-open menu → confirm.
- **Expected**: Cancel preserves the row; confirm removes it. Today's app
  has **no soft-delete / undo-toast** — the original v6 spec for a 5 s
  undo window has not been built. Track the future undo affordance under a
  separate ID once the design lands.

### ✅ TXN-DEL-FC-002 — Deletion updates all dependent aggregates atomically
- **Steps**: Delete a row that participates in a budget + a goal + a split.
- **Expected**: Row gone from list, NetWorth/budget/goal aggregates updated,
  no orphan entries in `paymentLog`/`SplitInfo`.

### 🟡 TXN-DEL-FC-003 — Deleting a debt-payment transaction restores debt balance
- **Preconditions**: Debt $4,927 (after a $150 payment $77 int / $73 princ).
- **Steps**: Delete the payment transaction.
- **Expected**: Debt balance reverts to $5,000; `paymentLog` entry removed.

### 🟡 TXN-DEL-FC-004 — Deleting a split anchor cleans up participants
- **Steps**: Delete the originating split transaction.
- **Expected**: Splits page no longer shows the IOUs; settlement transactions
  remain but are unlinked (or designer-prescribed behaviour, see Clarification #5).

---

# §4 · NetWorth Module Impact (NWRT-FC)

### 🟠 NWRT-FC-001 — Expense reduces asset balance (Phase A)
- **Scenario**: $500 expense on $10k Checking → NetWorth $9,500.
- **Blocked**: Auto-Linking Phase A — `upsertTransaction` does not mutate
  `Asset.value` today. Same dependency as NWRT-FC-002.

### 🟠 NWRT-FC-002 — Income increases asset balance (Phase A)
- **Scenario**: $5k salary into $10k Checking → NetWorth $15,000.
- **Blocked**: Auto-Linking Phase A. Currently `fixme` in
  `react/e2e/tests/networth-impact.spec.ts`.

### ✅ NWRT-FC-003 — Adding an asset increases total assets
- **Scenario**: Add Real Estate $500k, liquidity `long`.
- **Expected**: Total Assets +$500k; liquidity ratio recomputes.

### ✅ NWRT-FC-004 — Adding a debt increases total liabilities
- **Scenario**: Mortgage $300k → Liabilities +$300k; Net Worth = A − L.

### 🟠 NWRT-FC-005 — Multi-currency assets convert to base currency (Phase A)
- **Scenario**: $10k USD + €100k EUR at 1.1 → $120k USD total. The
  conversion math is testable now; the **transaction→asset reflection**
  half of the assertion ("after a multi-currency expense the converted
  total drops") needs Phase A.

### 🟠 NWRT-FC-006 — Financial ratios update when inputs change (Phase A)
- **Scenario**: After a $1k expense, expect Emergency-Coverage months and
  Liquidity Ratio both to recompute from the updated balances. Blocked on
  Phase A for the same reason as NWRT-FC-001/002.

---

# §5 · Budgets Module (BDGT-FC)

### 🟡 BDGT-FC-001 — Create monthly budget
- **Steps**: Add Food $300/month.
- **Expected**: Appears with 0 % used; period = monthly.

### 🟡 BDGT-FC-002 — Spend within a budget updates "used" and progress bar
- **Steps**: $120 expense in Food.
- **Expected**: Bar = 40 %; remaining = $180.

### 🟡 BDGT-FC-003 — Crossing the threshold fires a notification
- **Preconditions**: Call `updateNotificationPrefs({ budget_threshold: true })`
  before the run — `DEFAULT_PREFS.budget_threshold = false` in
  `react/src/lib/notifications.ts`, so the notification is off out-of-the-box.
- **Steps**: Cross 80 % threshold (default).
- **Expected**: Notification `type='budget_threshold'` with budgetId; visible
  in the in-app NotificationCenter only. `showWebPush` is wired exclusively
  for `missed_payment` + `goal_milestone` (see `store.ts`), so web-push
  delivery is **not** asserted here.

### 🟡 BDGT-FC-004 — Multi-period budgets (quarterly, half-yearly, annual)
- **Scenario**: Create quarterly budget; record expenses across 3 months.
- **Expected**: Spend aggregates across the quarter; rolls over correctly at
  period boundary.

### 🟡 BDGT-FC-005 — Custom-window budget enforces start/end dates
- **Scenario**: `period='custom'`, `periodStart=2026-06-01`, `periodEnd=2026-06-15`.
- **Expected**: Only transactions inside the window count; transactions on
  2026-06-16 are excluded.

### 🟡 BDGT-FC-006 — Edit budget limit recomputes utilisation
- **Steps**: Change limit $300 → $200 with $150 already spent.
- **Expected**: Bar jumps to 75 %; threshold logic re-evaluates.

### 🟡 BDGT-FC-007 — Budget overrun shows over-budget styling
- **Steps**: Cross 100 %.
- **Expected**: Bar terracotta; "+$50 over" badge; Pulse Score "Budget
  Compliance" component drops.

### 🟡 BDGT-FC-008 — Budget surplus surfaces in dashboard insight 🟠
- **Scenario**: Period ends under-spent.
- **Expected**: *Pending designer decision — see Clarification #3.*

---

# §6 · Goals Tracking (GOAL-FC)

### 🟡 GOAL-FC-001 — Create savings goal with target + deadline
### 🟡 GOAL-FC-002 — Manually update goal progress
### 🟡 GOAL-FC-003 — Goal linked to asset auto-updates from transfer 🟠 (Clar. #2)
### 🟡 GOAL-FC-004 — Goal progress aggregates multi-source contributions 🟠 (Clar. #2/#3)
### 🟡 GOAL-FC-005 — Debt-type goal tracks payoff progress
- **Expected**: `current` = remaining balance; bar fills as debt shrinks.

### 🟡 GOAL-FC-006 — Milestone notification at 50 / 75 / 100 %
### 🟡 GOAL-FC-007 — Projected completion date from contribution history
### 🟡 GOAL-FC-008 — Auto-complete flag at 100 %
- **Expected**: `Goal.completed=true`; moved to "Completed" tab; subsequent
  contributions do not push `current` past `target`.

*(Each row above follows the same Scenario / Preconditions / Steps / Expected
template as §1; collapsed here for readability. Implementers must fill in the
exact selectors per the Page-Object guide at the end.)*

---

# §7 · Debt Payment Cascading (DEBT-FC)

### ✅ DEBT-FC-001 — Create debt with principal, rate, minimum payment
### ✅ DEBT-FC-002 — Recording payment splits interest / principal correctly
- **Math**: $150 on $5k @ 18.5 % APR → interest $77.08, principal $72.92,
  balance $4,927.08. Use exact dinero arithmetic per `lib/amortization.ts`.

### ✅ DEBT-FC-003 — Debt-payment transaction appears in Transactions list
**Expected**: Recording a payment writes the linked debt transactions into
the Transactions list and preserves `linkedDebtId` / shared `linkedTxnId`
metadata for the generated pair.

### 🟡 DEBT-FC-004 — Avalanche extra-payment cascade
- **Scenario**: 18.5 % debt vs 8 % debt; extra $500 → all extra hits 18.5 % first.

### 🟡 DEBT-FC-005 — Snowball extra-payment cascade
- **Scenario**: Same two debts; extra $500 → all extra hits the smaller balance.

### ✅ DEBT-FC-006 — Part-payment with `partChoice='reduce_tenure'`
**Expected**: `remainingMonths` decreases; EMI unchanged.

### ✅ DEBT-FC-007 — Part-payment with `partChoice='reduce_emi'`
**Expected**: EMI recomputed downward while the remaining tenure simply
ticks down by the current payment month.

### ✅ DEBT-FC-009 — Part-payment with `partChoice='apply_advance'`
**Expected**: Payment covers future EMIs in advance, reducing
`remainingMonths` by more than the current month while leaving the EMI
amount unchanged.

### 🟡 DEBT-FC-008 — Paying a debt to zero marks it inactive
- **Expected**: Debt no longer appears on Liabilities side of NetWorth; final
  payment row preserved in `paymentLog`; Pulse "Debt Health" component improves.

---

# §8 · Asset Management (ASSET-FC)

### ✅ ASSET-FC-001 — Create asset of each liquidity tier (liquid/short/long)
### ✅ ASSET-FC-002 — Edit asset value and `lastUpdated` stamp updates
### 🟡 ASSET-FC-003 — Delete asset removes from NetWorth + relinks transactions
- **Expected**: Transactions previously holding the asset's id show "Account
  removed" placeholder; aggregates exclude the asset.

### ✅ ASSET-FC-004 — Liquidity ratio uses only `liquid`-tier assets
- **Expected**: A long-tier asset increase does **not** raise the liquidity ratio.

### 🟡 ASSET-FC-005 — Manual value edit creates an audit trail entry (v7)
- **Expected**: History view shows old → new transition with timestamp.

---

# §9 · Split Payments (SPLIT-FC)

### 🟡 SPLIT-FC-001 — Create even split with N participants
### 🟡 SPLIT-FC-002 — Create uneven split (per-participant `share` differs)
- **Expected**: Sum of shares = `totalAmount`; validator blocks otherwise.
### 🟡 SPLIT-FC-003 — Mark participant settled; IOU disappears from Splits page
### 🟡 SPLIT-FC-004 — `paidBy='external'` split — only your share counts as expense
### 🟡 SPLIT-FC-005 — Settlement persists across reload 🟠 (Clar. #5)
### 🟡 SPLIT-FC-006 — Settlement deposit reflects in NetWorth on selected asset 🟠 (Clar. #1)

---

# §10 · Recurring Transactions (RECUR-FC)

### 🟡 RECUR-FC-001 — Create weekly recurring schedule
### 🟡 RECUR-FC-002 — `autoConfirm=true` auto-generates on `nextDueDate`
- **Tooling**: `page.clock.fastForward` to advance virtual time.
### 🟡 RECUR-FC-003 — `reminderLeadDays=3` fires `upcoming_bill` notification
### 🟡 RECUR-FC-004 — Skip / defer one instance; future schedule unaffected
### 🟡 RECUR-FC-005 — Monthly with `dayOfMonth=31` handles February correctly
- **Expected**: Falls back to last day of month; no exception.
### 🟡 RECUR-FC-006 — Weekly `weekday` field schedules on correct day
### 🟡 RECUR-FC-007 — Recurring income visible in goal projection timeline

---

# §11 · Notifications System (NOTIF-FC)

### 🟡 NOTIF-FC-001 — Master toggle off suppresses all notifications
### 🟡 NOTIF-FC-002 — Per-type toggle (e.g. `budget_threshold=false`) is honoured
### 🟡 NOTIF-FC-003 — Quiet hours suppress web-push notifications
- **Scenario**: Set quiet 22:00–07:00; trigger a `missed_payment` or
  `goal_milestone` at 23:00 → no `showWebPush` invocation; the
  in-app NotificationCenter entry is still created so nothing is lost.
- **Note**: Only `missed_payment` and `goal_milestone` route through
  `showWebPush` (`react/src/store.ts`); other types are in-app only and
  unaffected by quiet hours.
### 🟡 NOTIF-FC-004 — Marking notification read updates badge count
### 🟡 NOTIF-FC-005 — Dismissed notification persists across reload
### 🟡 NOTIF-FC-006 — Web-push opt-in flow (when supported) `@cloud`

---

# §12 · Reports & Analytics (RPT-FC)

### ✅ RPT-FC-001 — Each period selector (Day/Week/Month/Quarter/Year) re-renders charts
### ✅ RPT-FC-002 — Empty-state copy shown when no transactions in period
### ✅ RPT-FC-003 — Donut breakdown matches sum of expense category totals
- **Property**: Sum of all donut slice values = total expense for the period
  (assert exactly via dinero arithmetic; no penny drift).
### 🟡 RPT-FC-004 — Filter by member narrows all charts consistently
### 🟡 RPT-FC-005 — CSV export contains the rows the chart is built from
### 🟡 RPT-FC-006 — Print-friendly Reports page renders without sidebar

---

# §13 · Family Pulse Score™ (PULSE-FC)

### 🟡 PULSE-FC-001 — Score weights match the documented 25/25/15/15/20 split
- **Method**: Construct a seed that yields known component values; assert
  the composite equals the weighted sum to 2 dp **when every component
  has data**. See PULSE-FC-005/006 for the renormalisation cases.

### 🟡 PULSE-FC-002 — Budget Compliance component drops on over-budget
### 🟡 PULSE-FC-003 — Debt Health component improves after debt payoff
### 🟡 PULSE-FC-004 — Score is stable across reload (no recompute drift)

### ✅ PULSE-FC-005 — Empty household yields `total: null` and "Building your Pulse…" prompt
- **Scenario**: Fresh install, no transactions / budgets / goals / debts.
- **Expected**: PulseGauge renders the earnable empty state (v6.6.0) and
  the composite is `null`, not `0`. Regression guard against the pre-v6.6.0
  "0 % out of nowhere" rendering.

### ✅ PULSE-FC-006 — Debt-free household renormalises remaining components
- **Scenario**: Household has income/expenses/budgets/goals but zero debts.
- **Expected**: Debt Health is excluded from the weighted sum and the
  remaining four components are renormalised to 100 %; total stays in the
  0–100 range and does not double-count.

---

# §14 · Login, Registration & Session (AUTH-FC) `@cloud`

### 🟡 AUTH-FC-001 — Sign-up with valid email + strong password
### 🟡 AUTH-FC-002 — Weak password rejected with inline guidance
### 🟡 AUTH-FC-003 — Invalid email format rejected
### 🟡 AUTH-FC-004 — Sign-in with valid credentials lands on dashboard
### 🟡 AUTH-FC-005 — Sign-in with wrong password shows generic error (no user enumeration)
### 🟡 AUTH-FC-006 — Sign-out clears session and bounces to `/auth/sign-in`
### 🟡 AUTH-FC-007 — Reset-password email link sets a new password
### 🟡 AUTH-FC-008 — Accept household invitation joins shared household
### 🟡 AUTH-FC-009 — Session restored from refresh token after browser restart
- **Tooling**: Persist storage state via Playwright `storageState`.

### ✅ AUTH-FC-010 — "Continue with Google" CTA visible on Sign In / Sign Up / Reset
- **Scenario**: v7.0.1 shipped the Google button as a no-op placeholder
  (renders in local-only too).
- **Expected**: Button is visible on `/auth/sign-in`, `/auth/sign-up`,
  `/auth/reset` (and the alias `/auth/reset-password`); clicking surfaces the
  "Coming soon" toast and does **not**
  navigate. Not gated `@cloud`.

### 🟡 AUTH-FC-011 — Reset page offers magic-link + Google fallback when cloud enabled `@cloud`
- **Scenario**: v6.6.0 added fallback paths next to the email-reset form.
- **Expected**: Magic-link request submits and surfaces a "check your
  email" confirmation; Google button behaves per AUTH-FC-010.

### ✅ AUTH-FC-012 — Reset page shows no-cloud guidance when Supabase env absent
- **Scenario**: No `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- **Expected**: Reset form is disabled with copy explaining cloud is not
  configured and pointing to the local JSON-backup path.

---

# §15 · Account Details & Profile (PROFILE-FC)

### ✅ PROFILE-FC-001 — Edit name + email
### ✅ PROFILE-FC-002 — Change `baseCurrency` reformats every money display
### ✅ PROFILE-FC-003 — Change language + `dateFormat` updates shipped labels and date surfaces
- **Coverage**: Assert current translated headings / labels plus visible date
  rendering surfaces (for example transaction rows and date chips). Broader
  locale sweeps (hi/ja across more pages) are still useful extensions, but
  the current shipped contract is narrower than the original "everywhere"
  wording implied.
### ✅ PROFILE-FC-004 — Change household type persists in profile settings
- **Checkpoint note**: The current app does **not** gate member features off
  `profile.household`; keep this row scoped to persistence / display until the
  product ships explicit household-type-conditioned behaviour.
### ✅ PROFILE-FC-005 — Change payoff strategy reorders Payoff Schedule
### ✅ PROFILE-FC-006 — Change `extraPayment` updates payoff projections
### ✅ PROFILE-FC-007 — Theme switch (warm / dark / system) persists across reload

### ✅ PROFILE-FC-008 — Sensitive data actions are surfaced only in Settings *(v7.3.1)*
- **Scenario**: Open the main drawer, then navigate to Settings → Sync & Backup.
- **Expected**: The sidebar / hamburger drawer does **not** expose `Export CSV`
  or `Clear Data` shortcuts. Settings remains the only visible location for
  export-related actions and shows the warning callout about sensitive data
  leaving the app.

---

# §16 · Multi-Household & Members (HH-FC)

### 🟡 HH-FC-001 — Create second household; switcher lists both
### 🟡 HH-FC-002 — Switching household isolates data (no cross-bleed)
### 🟡 HH-FC-003 — Add member; member appears in transaction member dropdown
### 🟡 HH-FC-004 — Change member role (primary/partner/child/elder); role badge updates
### 🟡 HH-FC-005 — Invite member by email (`@cloud`); pending state shown until accept
### 🟡 HH-FC-006 — Viewer role cannot edit or delete (read-only enforcement)

---

# §17 · Cloud Sync & Conflict Resolution (SYNC-FC) `@cloud`

### 🟡 SYNC-FC-001 — Local edit syncs to cloud on next push
### 🟡 SYNC-FC-002 — Cloud edit propagates to a second open session (realtime)
### 🟡 SYNC-FC-003 — Optimistic concurrency rejects stale update (TD-03)
- **Scenario**: Device A reads row v1, Device B writes v2, Device A writes
  v1 → adapter returns conflict, UI prompts merge.
### 🟡 SYNC-FC-004 — Cache no-clobber: empty cloud response does not wipe local
- **Why**: Regression guard for v6.4's "data lost on sign-out → sign-in".
### 🟡 SYNC-FC-005 — Empty-cloud warning points users to Force Resync without wiping cache
- **Checkpoint note**: `forceFullResync()` exists in the adapter and the app
  surfaces a warning toast, but there is no visible Settings "Resync" control
  in the current shipped UI.
### 🟡 SYNC-FC-006 — Offline edits queue, then flush on reconnect

---

# §18 · Backup & Data Portability (BACKUP-FC)

### ✅ BACKUP-FC-001 — Downloaded JSON backup contains the current profile, entities, and rates snapshot
- **Property**: The exported JSON includes `version`, `exported`, `profile`,
  `transactions`, `budgets`, `goals`, `members`, `debts`, `assets`, and
  `exchangeRates`.
### ✅ BACKUP-FC-002 — Download Backup triggers a browser download with the shipped Vyact filename pattern
- **Expected**: Download starts with `vyact-backup-<date>.json` and surfaces
  the success toast.
### ✅ BACKUP-FC-003 — Copy to Clipboard writes the full JSON snapshot and surfaces success feedback
### ✅ BACKUP-FC-004 — CSV export contains the shipped transaction columns for the current dataset
- **Checkpoint note**: The current implementation exports the full transaction
  store (Date/Type/Description/Category/Amount/Currency/Note); it does **not**
  honour the Transactions page's active UI filters yet.
### ✅ BACKUP-FC-005 — Backup/export actions remain reachable in local-only mode

---

# §19 · Search & Filter (SEARCH-FC)

### ✅ SEARCH-FC-001 — Free-text search matches description, note, category
### ✅ SEARCH-FC-002 — Structured filters (type/category/month/member) narrow the transactions list
### ✅ SEARCH-FC-003 — Calendar day selection narrows the list and surfaces a clearable date chip
### ✅ SEARCH-FC-004 — Empty result shows actionable empty state (not blank)

---

# §20 · Onboarding & Templates (ONB-FC)

### 🟡 ONB-FC-001 — Explicit `/onboarding` visit opens the template-first wizard
### ✅ ONB-FC-002 — Template `family` seeds expected categories + budgets
### ✅ ONB-FC-003 — Chosen `primaryConcern` persists in onboarding profile metadata
### ✅ ONB-FC-004 — Fresh local users land on dashboard with empty state (onboarding remains opt-in)
### ✅ ONB-FC-005 — `onboardedAt` set so onboarding never re-prompts

---

# §21 · Privacy / Excluded Transactions (PRIV-FC)

### ✅ PRIV-FC-001 — Marking a transaction `excluded=true` adds the 🔒 stripe + badge
### ✅ PRIV-FC-002 — Excluded transactions skip transaction-derived aggregations
- **Assertions**: Reports, Pulse, Budgets, Goals — none change when toggling
  `excluded` on/off for the same transaction.
- **Note**: NetWorth is computed from `Asset.value` + `Debt.balance` today
  (no transaction summation), so it is **not** asserted here. Re-include
  NetWorth in this row once Auto-Linking Phase A lands.
### 🟡 PRIV-FC-003 — Settings → Account Stats keeps raw transaction counters visible with excluded rows present

---

# §22 · Investment Auto-Update (INV-FC)

### 🟡 INV-FC-001 — Investment transaction with auto-update increments asset value
### 🟡 INV-FC-002 — Disabling auto-update keeps asset value flat
### 🟡 INV-FC-003 — Editing the investment transaction adjusts asset by the delta only

---

# §23 · Multi-Currency & FX (FX-FC)

### ✅ FX-FC-001 — Editing an exchange rate re-renders converted totals everywhere
### 🟡 FX-FC-002 — Rounding uses banker's rounding at the target's native exponent
- **Property**: A 300-row schedule must end exactly on `0.00` outstanding —
  no per-step drift (`lib/amortization.ts` guarantee).
### 🟡 FX-FC-003 — Sums in dinero space match per-row currency-formatted values
### 🟡 FX-FC-004 — Cloud `numeric(15,2)` string serialisation parses via `parseMoneyFromCloud`
### ✅ FX-FC-005 — Switching `baseCurrency` re-anchors every chart without precision loss

---

# §24 · Keyboard Shortcuts & Accessibility (A11Y-FC)

### ✅ A11Y-FC-001 — `N` opens Add Transaction and `Esc` closes the active modal
- **Checkpoint note**: The help text still mentions `G` / `D` / `A` / `/`,
  but the current shipped shortcut wiring only registers `n` / `N` on the
  Transactions page plus modal-level `Escape` close.
### 🟡 A11Y-FC-002 — Modal focus trap returns focus to the trigger on close
- **Checkpoint note**: Current modals expose `role="dialog"` and `Escape`
  close, but they do not yet implement a true focus trap or trigger-focus
  restoration.
### 🟡 A11Y-FC-003 — `aria-live` announces toast notifications
- **Checkpoint note**: `ToastHost` currently renders visually only; the live
  region behaviour exists elsewhere (for example `UpdateBanner`), not on
  toast notifications themselves.
### ✅ A11Y-FC-004 — Tab order on transaction form is logical and complete
### 🟡 A11Y-FC-005 — Colour contrast ≥ AA on both warm and dark themes (sample 5 pages)

---

# §25 · Responsive & Mobile Layout (RESP-FC)

### ✅ RESP-FC-001 — ≥1100 px renders the full desktop layout
### ✅ RESP-FC-002 — ≤820 px collapses sidebar into hamburger menu
### 🟡 RESP-FC-003 — Below the desktop breakpoint, dashboard sections stack into a single column while the KPI cards remain readable two-up
### ✅ RESP-FC-004 — Floating action buttons (Planner / Chat) are reachable on mobile
### ✅ RESP-FC-005 — Drawer labels for Accounts / Insights stay title-cased and readable *(v7.3.1)*
- **Scenario**: Open the navigation drawer on a narrow viewport with English
  locale active.
- **Expected**: The visible nav labels render as `Accounts` and `Insights`
  (not raw lowercase fallback keys), and the text alignment/weight matches the
  rest of the drawer items.

---

# §26 · Performance & Large Datasets (PERF-FC)

### 🟡 PERF-FC-001 — 5,000 transactions render and scroll smoothly
- **Method**: Seed 5k rows; assert first paint < 2 s; scroll at 60 fps median.
### 🟡 PERF-FC-002 — Reports period switch on 5k dataset re-renders < 800 ms
### 🟡 PERF-FC-003 — Amortisation schedule of 360 rows computes < 250 ms
### 🟡 PERF-FC-004 — Initial JS bundle (excluding charts) under 250 KB gzipped
- **Method**: Inspect built `dist/assets` sizes in CI step.

---

# §27 · Error Resilience & Edge Cases (ERR-FC)

### ✅ CON-E2E-005 — Error boundary shows fallback UI
- **File**: `error-boundary.spec.ts`
- **Steps**: Visit `/__e2e_error` → assert "Something broke" + "Your data is
  safe locally." → click "Try Again" → fallback disappears.

### 🟡 ERR-FC-001 — Adapter network failure surfaces toast, retains local cache `@cloud`
### 🟡 ERR-FC-002 — Schema migration failure surfaces "Could not upgrade data" with backup link
### 🟡 ERR-FC-003 — Calling `forceFullResync()` re-establishes per-entity sentinel `@cloud`
### 🟡 ERR-FC-004 — Time-zone change on the host does not shift transaction dates
### 🟡 ERR-FC-005 — `localStorage` quota exceeded shows a clear, recoverable error

---

## Designer Clarifications

Questions #1, #2, #3, #5 are now resolved by the phased work captured in
`docs/ROADMAP_AUTO_LINKING.md` — the affected tests carry the Phase tag
rather than a Clarification 🟠. Only #4 remains an open product question.

| # | Question | Status | Affected IDs |
|---:|---|---|---|
| 1 | Expense→asset linking: automatic from a primary account, manual every time, or remembered per category? | ✅ Resolved by **Auto-Linking Phase A** | TXN-FC-002, NWRT-FC-001/002/005/006, SPLIT-FC-006 |
| 2 | Income→goal: auto-credit when the receiving asset is linked, or always manual? | ✅ Resolved by **Auto-Linking Phase B** | GOAL-FC-003, GOAL-FC-004 |
| 3 | Budget surplus: auto-route to a designated goal, manual allocation, or unallocated? | ✅ Resolved by **Auto-Linking Phase C** | BDGT-FC-008, GOAL-FC-004 |
| 4 | Future-dated transactions: blocked, allowed as pending, or allowed unrestricted? | 🟠 **Open** | TXN-FC-006, RECUR-FC |
| 5 | Split anchor deletion: cascade settlement transactions or leave them unlinked? | ✅ Resolved by **Auto-Linking Phase D** | SPLIT-FC-005, TXN-DEL-FC-004 |

---

## Required Test Infrastructure

### Page Objects (`react/e2e/pages/`)
- ✅ `DashboardPage`, `TransactionsPage`, `TransactionFormModal`,
  `NetWorthPage`, `BudgetsPage`, `GoalsPage`, `DebtsPage`, `AssetsPage`
  *(scaffolding PR — Phase 1 ready)*
- 🟡 `SplitsPage`, `ReportsPage`, `RecurringPage`, `NotificationCenter`,
  `SettingsPage` (with nested `AccountSection`, `LocalizationSection`,
  `AppearanceSection`, `DebtPrefsSection`, `SyncSection`),
  `AuthPage` (sign-in/up/reset/accept-invite), `OnboardingPage`,
  `HouseholdSwitcher`, `SearchBar`.

### Fixture Extensions (`react/e2e/fixtures/`)
- ✅ `advanceClock(epochMs | dateString)` helper wrapping
  `page.clock.setFixedTime`.
- ✅ `seedWith({ debts?, goals?, recurring?, splits?, members?, assets?, profile? })`
  factory that deep-merges into `defaultSeed`.
- ✅ `sampleCreditCardDebt` reference seed for §7 DEBT-FC.
- 🟡 `mockExchangeRates(rates)` to pin FX for FX-FC suite.
- 🟡 `withCloud()` wrapper running against an ephemeral Supabase branch
  via the Supabase MCP (`create_branch` / `delete_branch`). Mock path
  abandoned — see `docs/ROADMAP_AUTO_LINKING.md` rationale on testing
  against the real cloud boundary.

### Test Hooks in App Code
- ✅ `/__e2e_error`
- 🟡 `/__e2e_debt_error`, `/__e2e_split_error`, `/__e2e_sync_conflict`
- ✅ `window.__vt_store` oracle (with `window.__ff_store` alias for
  in-flight specs; alias retires once every spec migrates).
- 🟡 A `window.__vt_clock` sanity-check hook for the mocked `Date.now`.
  Today specs rely on Playwright's `page.clock` directly; the in-app hook
  is optional.

---

## CI Integration

### Job graph (`.github/workflows/ci.yml`)

```
react-test
  ├─ react-lint            (eslint + tsc --noEmit)
  ├─ react-unit            (vitest)
  ├─ react-e2e-local       (playwright, default project, all non-@cloud)
  └─ react-e2e-cloud       (playwright, --grep @cloud, runs only on PRs that
                            touch lib/supabaseAdapter.ts, lib/auth.ts,
                            components/auth/**, or are tagged `cloud-required`)
```

### Inventory-freshness gate

```yaml
- name: Test inventory freshness
  run: |
    if git diff --name-only origin/main... | grep -qE '^react/src/'; then
      if ! git diff --name-only origin/main... | grep -q 'react/e2e/TEST_CASE_INVENTORY.md'; then
        echo "::error::App source changed without updating TEST_CASE_INVENTORY.md"
        exit 1
      fi
    fi
```

### Reporting
- Playwright HTML report uploaded as a CI artifact for every run.
- A nightly job posts a Slack summary (counts of ✅ / 🟡 / 🔴 by area) to the
  team channel, sourced from this file's status legend.

---

## Owners

| Area | Owner |
|---|---|
| Foundation, Performance, A11y, Responsive | TBD |
| Transactions, Budgets, Goals, Debts, Assets, NetWorth | TBD |
| Splits, Recurring, Notifications | TBD |
| Auth, Multi-Household, Cloud Sync | TBD |
| Reports, Pulse, Search, Onboarding, FX | TBD |
| Privacy, Investment, Error Resilience, Backup | TBD |

> Replace `TBD` with the GitHub handles of the engineers accountable for
> keeping each section honest. The quarterly audit (see Maintenance Rules)
> is owned by these names.

---

## Effort Estimate

Ballpark to take the inventory from **70 / 174 (40.2 %) to 100 %** on
Playwright. That leaves **104 remaining rows**: `94` implementation-ready and
`10` blocked on product/app gaps. Numbers assume one engineer already familiar
with the current Playwright harness and Vyact's seeded local-only test model;
adjust ±25 % for less-familiar engineers or if the blocked product surfaces
ship with major UI changes.

### Per-test complexity rubric

| Tier | Description | Hours / test | Examples |
|---|---|---:|---|
| **S — Simple** | Single screen, CRUD, validation, no time/cloud/perf concerns | **3 h** | TXN-FC-001/005/007, SEARCH-FC-*, PROFILE-FC-001 |
| **M — Medium** | Cross-module assertions, calculations, multi-step flows | **6 h** | NWRT-FC-*, BDGT-FC-*, TXN-EDIT-FC-001..005, RPT-FC-* |
| **C — Complex** | Time manipulation, cloud sync, conflict resolution, performance budgets, dinero math validation | **12 h** | RECUR-FC-*, SYNC-FC-*, PERF-FC-*, FX-FC-002, DEBT-FC-004/005, PULSE-FC-001 |

### Remaining test-build effort (104 open rows)

| Tier | Count | Hours each | Subtotal |
|---|---:|---:|---:|
| Simple | ~5 | 3 | 15 h |
| Medium | ~64 | 6 | 384 h |
| Complex | ~35 | 12 | 420 h |
| **Test development subtotal** | **104** | | **~819 h** |

### Remaining infrastructure & enablement

| Item | Hours |
|---|---:|
| Remaining page objects / helpers (`SplitsPage`, `ReportsPage`, `RecurringPage`, `NotificationCenter`, `SettingsPage` subsections, `AuthPage`, `OnboardingPage`, `HouseholdSwitcher`) | ~36 h |
| Fixture extensions still missing (`mockExchangeRates`, cloud wrapper hardening, viewport presets, download/clipboard helpers) | ~22 h |
| App-side test hooks still useful (`/__e2e_debt_error`, `/__e2e_split_error`, `/__e2e_sync_conflict`, optional clock sanity hook) | ~12 h |
| Cloud environment hardening (`@cloud` branch lifecycle, seeded auth/household data, CI split validation) | ~18 h |
| Inventory / handoff upkeep as rows land | ~8 h |
| **Infrastructure subtotal** | **~96 h** |

### Ongoing overheads

| Item | Hours |
|---|---:|
| Flake stabilisation (~12 % of remaining test dev) | ~99 h |
| App-bug triage surfaced by new coverage | ~36 h |
| Code review / inventory hygiene for the remaining PRs | ~56 h |
| **Overhead subtotal** | **~191 h** |

### Grand total

| Bucket | Hours |
|---|---:|
| Test development | 819 |
| Infrastructure | 96 |
| Overhead | 191 |
| **TOTAL** | **~1 106 h** |

Converted:

| Capacity | Calendar time |
|---|---|
| 1 engineer, 100 % dedicated | **~6–6.5 months** |
| 2 engineers in parallel (some cloud/infra serialisation) | **~4 months** |
| 1 lead + 2 implementers | **~3–4 months** |
| Realistic mixed team with normal product interruptions | **~4.5–5 months** |

### Phased delivery (recommended — burn the counter down in chunks)

| Phase | Scope | Tests added | Hours | Cum. Developed | Cum. % |
|---:|---|---:|---:|---:|---:|
| 0 | Today (already shipped) | — | — | 70 | 40 % |
| 1 | Remaining truthful local wave: reclassify the final responsive/privacy drift rows, then mop up any tiny settings drift cleanups | ~1 | ~6 h | 71 | 41 % |
| 2 | Core transactional flows: remaining TXN / TXN-EDIT / TXN-DEL, Budgets, Debts, Assets, Reports, Pulse, Privacy | ~38 | ~255 h | 101 | 58 % |
| 3 | Breadth + time-based state: Goals, Splits, Recurring, Notifications, Onboarding, Responsive, Performance, Error Resilience | ~35 | ~285 h | 136 | 78 % |
| 4 | Cloud + app-gap tail: Auth, Households, Sync, and blocked Auto-Linking rows once product surfaces ship | ~38 | ~273 h | 174 | **100 %** |
|   | **Total** | **104** | **~819 h** test dev only (infra/overhead amortised across phases) | | |

### Risk / sensitivity

- **Only Clarification #4 remains open**, but it still blocks `TXN-FC-006`
  and can ripple into future recurring-policy assertions.
- **Ten rows remain blocked on missing product surface** (mostly Auto-Linking
  phases plus two A11Y gaps). If the feature work slips, Phase 4 slips with it.
- **Cloud harness readiness** remains the largest schedule swing. The `@cloud`
  bucket accounts for 18 rows and can move by ±40 h depending on Supabase
  branch setup stability.
- **Rewritten rows reduce ambiguity but not effort**: the 16 revised rows are
  now accurate, but they still need implementation and focused validation.

### How to update this section

When you ship test IDs:

1. Bump the **Progress Tracker** counter at the top of this file.
2. Flip the row's status icon from 🟡 to ✅ in its functional area.
3. Note actual hours in your PR — quarterly we recalibrate the rubric against
   real data and revise the per-tier hour estimates in this section.

---

*Last reviewed: 2026-06-03. Inventory schema v1.*
