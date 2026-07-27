# Vyact Consumer App — Changelog

> Versioning record for the React consumer app at `react/`. Newest first.
>
> The consumer React app at `react/` continues the version line that began with the v1.0–v5.0 vanilla-shell releases at the repo root. The vanilla shell is **frozen at v5.0** and superseded by **v6.0** (the React port). All v6+ versions are React-only.
>
> **Current production version: `v10.13.0`** (consumer)
> **Live URL:** https://vyact-twentyx.vercel.app
> **Money Map mode:** `'shadow'` by default on cloud builds — dual-writes
> the new FK columns; reads still prefer the legacy `linkedAssetId` so v7.1
> clients viewing the same household stay consistent. Promotes to `'on'` in
> v7.2.1 once parity dashboards confirm.
> **Next planned: see Roadmap at the bottom.**

## Version provenance & gaps

The numbering history has some non-monotonic stretches that we keep documented honestly here rather than papering over them. **Read this section once if a version number surprises you.**

| Version | Status | Note |
|---|---|---|
| v3.0 | **Never shipped** | "Themes, charts, settings, help" — UI shipped but JS logic was deferred and rolled into v4.0. No package was tagged. |
| v4.1 | Two distinct meanings | (a) Internal adapter refactor on the vanilla shell; (b) the cloud / auth / multi-household ship that bound the React app to Supabase. Both kept under v4.1 because the second built directly on the first and nothing was deployed between them. |
| v6.1 | **Never shipped** | Reserved for the 7-page port-out from v5 vanilla → React. The port-out actually landed split across v6.2 (the Friction-free signup release) and v6.3 (Content + module port-out completion). |
| v7.0 / v7.5 | Shipped before v6.2 (chronologically) | The v7.x line was a **major-feature track** (Onboarding, EMI, Recurring, Notifications, Planner, Chat) that ran in parallel with the v6.x **integration & polish track**. Going forward we abandon the parallel-track scheme — every release is on a single increasing number from v6.4 onward. |

---

## v10.13.0 — Onboarding rebuilt + wired to real money *(2026-07-24)*

The onboarding flow is rebuilt to the Aurora `revamp/Vyact Aurora · Onboarding.html`
design and — for the first time — turns what you type into **real, first-class
money-model objects** you can see and edit from day one, instead of an
"estimated reference baseline" that wiped itself.

- **Redesigned six-screen flow** (`pages/Onboarding.tsx`): Welcome (currency set
  once here) → Who + your **first name** → What matters (multi-select) → Money in
  (take-home) → Money out (fixed bills with **amounts inline** + a live running
  total) → Reveal. pip greets you by name from step 2 on, and the Reveal is fully
  computed from what you entered (room left = take-home − fixed bills, your
  biggest fixed cost and its share of pay, a first Pulse). The separate
  cash/debt "snapshot" step is gone — take-home is the one cash figure.
- **The captured numbers become real money** (`lib/onboardingWiring.ts`):
  1. Monthly take-home → the default **Cash account's opening balance**
     (cash-in-hand today).
  2. Take-home → a recurring **paycheck** (income, monthly on the 1st, credited
     to Cash). Starts the *next* 1st (strictly future) so it never
     double-counts the opening balance, and is **approval-gated**
     (`autoConfirm:false`).
  3. Each fixed bill → a recurring **expense** (monthly on the 2nd, debiting
     Cash, in its mapped category) — future-dated + approval-gated, so
     **nothing auto-pays until you review it in Recurring**.
  4. The bills together → a **budget for your join month** (created even if the
     month is already underway), one allocation per category.
- **The money model is untouched by onboarding.** None of the above posts a
  transaction — opening balances, future-dated approval-gated *schedules* and
  budgets don't move spend/income. Verified in-browser end to end: after
  completing onboarding the transaction count was **unchanged** (nothing
  auto-posted), the Cash opening balance became the take-home figure, a
  day-1 income schedule and five day-2 expense schedules were created (all
  `autoConfirm:false`, future-dated, funded by Cash), and the join-month budget
  landed with its allocations.
- New `store.saveOnboardingBudget` creates the join-month budget without the
  owner/admin role gate — onboarding is, by definition, the owner setting up
  their own household (and local-only mode never populates `myRole`).
- New pure-helper unit tests (`lib/__tests__/onboardingWiring.test.ts`, 8 cases)
  pin the future-date math (schedules never start today), the chip→category
  map, and the per-category allocation merge.

Gates: `tsc` 0, `eslint` 0, `vitest` 169/170 (the one failure is the
pre-existing clock-dependent golden snapshot, unrelated; +8 new wiring tests;
money invariants green), `vite build` 0. Full flow walked in-browser
(salaried path, ₹/$ inputs), reveal figures correct, wiring inspected in the
live store.

---

## v10.12.0 — Section reshuffle + mobile Net Worth hero *(2026-07-24)*

- **Sections regrouped** (`components/layout/navModel.ts`, the single source
  of truth for the TopBar tabs, SubNav pills, ⌘K palette and mobile tab bar):
  **Track** = Dashboard · Transactions · Splits; **Plan** = Budgets ·
  Recurring · Debts · Accounts (Recurring moved in from Track); **Analyze** =
  Net Worth · Reports · Insights (Net Worth moved in from Plan). Every route
  stays reachable; `sectionForPath` and the SubNav derive from the model, so
  the whole shell followed automatically.
- **Dashboard mobile is now a swipeable hero carousel.** The Net Worth hero
  used to be desktop-only, folded into the Cash Flow card's footer on mobile.
  It's now its own full card that sits *beside* Cash Flow in a horizontal
  snap-scroll — swipe to see net worth, assets and liabilities without
  leaving Home. Desktop is unchanged (the two heroes stay side-by-side). The
  now-redundant folded "Net worth" footer line was removed so the figure
  isn't shown twice; the mobile footer shows the savings rate instead.

Gates: `tsc` 0, `eslint` 0, `vitest` 161/162 (pre-existing clock snapshot,
unrelated), `vite build` 0. Verified in-browser at mobile (375px, carousel
scrolls Cash Flow → Net Worth) and desktop (1280px, reverts to the 2-col
grid); Recurring now lands under Plan and Net Worth under Analyze with the
correct SubNav pills; no console errors.

---

## v10.11.1 — Fix: households could not be deleted; failed creates were silent *(2026-07-24)*

Two production bugs reported by a real user, both triaged to root cause and fixed.

- **Deleting a household always failed** with `insert or update on table
  "activity_log" violates foreign key constraint
  "activity_log_household_id_fkey"`. Root cause: `activity_log.household_id`
  is `references households(id) on delete cascade` — deleting a household
  cascades to delete every row referencing it (memberships, transactions,
  budgets, goals, debts, assets), and EACH of those cascaded deletes fires
  the `log_domain_activity()` audit trigger (TD-08), which tries to insert a
  fresh `activity_log` row for a household that, within the same
  transaction, `households(id)` no longer contains — so the insert's own FK
  check fails and the whole delete rolls back. This reproduced for **every**
  real household (every household has at least its owner's membership row).
  Fixed in `supabase/migrations/20260724120000_fix_household_delete_activity_log_fk.sql`:
  `log_domain_activity()` now swallows `foreign_key_violation` on that
  specific insert — a log entry for a household disappearing in the same
  transaction has no reader anyway (activity_log's own FK is also `on delete
  cascade`, so it would be removed the instant the delete completed). Applied
  to prod and verified live via a self-rolling-back `DO` block
  (`supabase/tests/household_delete_activity_log_regression.sql`):
  `memberships_before=1 household_gone=t orphan_activity_log_rows=0`.
- **"Sometimes I can't create a new household."** `CreateHouseholdModal`'s
  submit handler (`react/src/pages/Households.tsx`) had no `catch` around
  `await onCreated(...)` — any failure (an expired session making
  `getUser()` momentarily return no user, an RLS denial, a network blip)
  became an unhandled promise rejection: no toast, no message, the button
  just reverted from "Creating…" to "Create" with zero feedback. Fixed by
  wrapping the create call in `try/catch` + toast (matching the
  rename/leave/delete handlers already on this page) and re-throwing so the
  modal keeps the typed household name instead of clearing it like a
  successful submit.
- **Regression coverage added** (`react/e2e/TEST_CASE_INVENTORY.md` §16):
  `HH-REG-001`/`HH-REG-002` document both bugs with root cause + fix +
  verification; `HH-FC-007`/`HH-FC-008` cover create/delete directly (the
  existing HH-FC rows only covered switching/roles/invites). A new
  `HouseholdsPage` Playwright page object is wired into the fixture, ready
  for Lane B (the cloud test harness is still not implemented — see
  `e2e/README.md` — so these register as `test.fixme` backlog placeholders
  for now, consistent with every other `@cloud` row in the inventory).

Gates: `tsc` 0, `eslint` 0 errors (1 pre-existing unrelated warning), `vitest`
161/162 (pre-existing clock-dependent snapshot, unrelated), `vite build` 0.
DB fix verified live against production (`vyact` / `dmxqkvploojokffuhxnz`)
both before the fix (bug reproduced exactly) and after (bug gone, no
orphaned rows) via zero-cost, self-rolling-back `DO` blocks — no user data
touched. `get_advisors` shows no new security/performance findings.

---

## v10.11.0 — Aurora fidelity · Batch E: Settings, Households, Onboarding *(2026-07-23)*

Closes the three follow-ups tracked-but-deferred at the end of v10.5.0 (Batch E's
original ship): the grouped Settings list, the Households card grid + invite
half-sheet + role chips, and the Onboarding progress-ribbon/choice-card flow.
Presentation only — profile/password/MFA/danger-zone logic, household RLS and
invite flows, and the onboarding state machine are all untouched.

- **Settings is now the board's grouped `.set-group` navigation list**, not a
  flat stack of always-open panels. Every panel — Appearance, Notifications,
  Language & currency, Exchange rates, Debt preferences, Sync & backup,
  Password, Security, Account stats, Legal & policies — is a compact row
  (icon · label · value preview · chevron) under a caption (*Preferences* /
  *Data & security* / *About*), expanding in place to the exact same content
  and logic that used to render open-by-default; one row open at a time.
  Danger Zone gets its own **quarantined group** (sunken/inset background,
  never mixed into a regular list) instead of just being the last panel in the
  stack. A `#notifications` deep link (already used by Help/legal footers)
  still opens straight to that row.
- **Households page's household grid now matches the household-switch
  pull-down** (`HouseholdSheet.tsx`, Batch A): neu cards, the active
  household's real member-avatar stack (others fall back to initials), and a
  glowing accent ring + "✓ current" pill on the active card. Member rows get
  **role chips** (`.role` pill — solid accent for Owner, denim-tint for Admin,
  neu-inset neutral for everyone else) in place of the generic badge; the
  editable case keeps the native `<Select>` (a real dropdown beats a fake
  chip). The **invite flow is now a half-sheet** (`HalfSheet`, the same
  forms-doctrine container used everywhere else) instead of a generic modal.
- **Onboarding gets the pip-guided ribbon + neu choice cards.** The pip mascot
  now leads a compact header card at every step, and the flat progress bar is
  a coral-gradient neu ribbon. The segment picker (step 1) uses neu cards with
  an accent ring + ✓ badge on selection; every chip-style choice throughout
  the flow (adults/dependents/concern in step 2, fixed-cost chips in step 4)
  now uses the shared `Chip` component instead of hand-rolled pill buttons,
  for the same look and feel as every other add/edit form in the app. The
  Reveal step's stat cards and "picture confirmed" bar are restyled to match.

Gates: `tsc` 0, `eslint` 0 errors (all warnings pre-existing, untouched by this
diff), `vitest` 161/162 (the one failure is the pre-existing clock-dependent
golden snapshot — unrelated), `vite build` 0. Verified in-browser: Settings'
grouped rows expand/collapse correctly and the Danger Zone group's inset/sunken
styling computes correctly; the full Onboarding flow (all 5 steps) walks
through with the restyled ribbon, cards, and chips, landing on a correct Reveal
screen. The Households card-grid/invite-sheet/role-chip changes are a direct
adaptation of the already-shipped, already-verified `HouseholdSheet.tsx`
pattern; multi-household cloud mode isn't reachable in this local-only dev
session, so that specific surface rests on the tsc pass + pattern reuse rather
than a fresh live click-through.

---

## v10.10.0 — Net Worth goes live: default Cash account + live account balances *(2026-07-23)*

Closes the last gap in the Money Model: Net Worth's asset side now reads real,
live account balances instead of static `Asset.value` numbers, and every
household gets exactly one default Cash account from day one.

- **Every household gets a default "Cash in Hand" account, even at $0.** A new
  `ensureDefaultCashAccount()` (`crudSlice`) runs idempotently at app boot
  (`init()`) and household switch (`switchHousehold()`) — best-effort, never
  blocks. Exactly one cash-kind account per household is enforced at two
  layers: `upsertAccount` throws if a second one is attempted, and
  `AccountFormModal`'s Kind dropdown hides "Cash" once one exists (still
  selectable when editing the real one). This was necessary because
  `accountValueOf()` collapses every cash-kind account to the same literal
  `'cash'` key — a second one would silently double-count every cash
  transaction against both accounts.
- **Net Worth's Assets column is now LIVE, not static.** New `liveAssetRows()` /
  `liveTotalAssets()` (`lib/accountBalance.ts`) fold every non-archived
  cash/bank/investment `Account`'s real computed balance
  (`computeAccountBalance`) into the Assets list, de-duped against any legacy
  `Asset` a first-class account was backfilled from (`account.assetId` link) —
  so a Phase-1-backfilled account replaces its old static asset row instead of
  double-counting it, while genuinely standalone assets (real estate,
  retirement, vehicles) keep working exactly as before. Bank/investment
  accounts created in Settings → Accounts now show up on Net Worth
  automatically — previously this only worked for investment accounts via a
  broken auto-created shadow asset that froze at $0 forever and never updated;
  that whole mechanism is removed.
- **Onboarding's captured cash figure now funds the real Cash account**, not
  just the ephemeral reference baseline. `Onboarding.tsx` links the entered
  amount to the default Cash account's `openingBalance` (marked
  `confidence:'estimated', source:'onboarding'`), guarded so it never clobbers
  a balance already set. Net Worth is dynamic — driven by both cash and bank
  transactions — from the moment onboarding completes.
- **Amount field auto-focuses on Add Transaction** (not Edit) with the value
  pre-selected, so typing immediately overwrites it instead of landing in
  Description — the #1 source of "I typed the amount in the wrong field"
  confusion. `NumericKeypad.tsx`'s `AmountField` gained an `autoFocus` prop.
- Fixed a pre-existing Net Worth grid overflow guard (single-column fallback).
- New pinned invariant test — `§7 INV-7b` in
  `moneyModel.invariants.test.ts` — locks the de-dup/live-fold behavior into
  the money-model gate.

---

## v10.9.2 — Aurora fidelity · Batch D 3/3 · Ask Vyact (boards M6/M7/D3) *(2026-07-22)*

Final Analyze-section increment — Ask Vyact, completing Batch D.

- **The empty state is the hero** (board M6). The intent chips are now board
  `.intent` **rows** — an inset icon tile beside each label — grouped by the
  four production buckets (Capture · Inquire · Plan · Manage), replacing the
  flat pill row. Each `Intent` carries an `icon` glyph (new field on the type).
- **The privacy line reads in sage, not coral/terra.** "Private by design —
  nothing leaves it" is a *reassurance*; per the design system, crit is reserved
  for genuine failures, so a promise is not styled as an alarm.
- **Desktop is a right glass drawer over the dimmed app** (board D3). The Ask
  drawer (already launched from the top-bar ✦ chip + mobile tab-bar slot) is now
  a `glass-strong` panel with the board's header — a ✦ tile, the name, and the
  "On-device · private" subline — and a footer that states *Esc or click outside
  to close*. Width tightened to the board's 440px. `Chat` gained an `embedded`
  prop so the drawer's own header replaces the page's `<h1>` (the `/chat` route
  still renders standalone with its title).
- Conversation bubbles were already board-correct (`.bub.me` coral-right /
  `.bub.ai` neu-left) and are left as-is.

Not built: the board's live voice-**listening** overlay (pulsing mic + building
transcript). The mic button and Web Speech wiring already exist; the animated
listening state is a follow-up, flagged rather than faked.

## v10.9.1 — Aurora fidelity · Batch D 2/3 · Insights hub (boards M3/M5/D2) *(2026-07-22)*

Second Analyze-section increment — the Insights hub.

- **For You launch hero is glass over the ambient aurora** (board M3) and now
  says the quiet part out loud: *"A 60-second story on where your money moved —
  computed on your device, never guessed."* Leads with `{n} fresh cards this
  week` and a `▶ Play the reel` primary, over an "Or browse them" label.
- **Insight preview cards follow board `.icard`** — a severity **spine** down the
  left edge (sage positive · honey constructive · coral neutral, from the feed's
  existing `tone`), the emoji, then the number that matters at 26px tinted to
  match, then one line. Replaces the flat horizontal row.
- **Plan groups by SEVERITY, not domain** (board M5). Recommendations now sit
  under `▲ Critical · n` / `⚠ Watch · n` / `ⓘ Info · n` headers with the domain
  riding each card as a pill — the board's information hierarchy, inverted from
  the previous by-domain panels. The redundant 3-card severity count strip is
  gone (the group headers carry the counts).
- **The "no AI" promise is compact and denim-tinted** (board M5): *Recommendations
  follow fixed rules — no AI, no guessing. You decide what to act on.* Replaces
  the long bordered disclaimer while keeping the not-financial-advice line.
- **When nothing is critical the tone stays warm**, not empty: *"Nothing critical
  right now — you're steady 🌿"*.
- **Desktop shows what mobile tabs between** (board D2) — on `lg` the hub is
  `1.5fr · 1fr`: For You on the left, and a rail on the right carrying a
  condensed **Plan · recommendations** column (top 3, severity-spined, "🔒 rules,
  no AI") over a **Learn · evergreen** tile grid. Selecting Learn or Plan still
  opens that surface full-width; the rail is hidden below `lg`.

Unchanged after review: the For You reel (board M4) and Learn (board M8) already
match their frames — Learn has the search, Lessons/Updates segment, topic chips
and format badges. Learn's featured-media hero is not built: it needs real
thumbnail media the bundled library doesn't carry.

## v10.9.0 — Aurora fidelity · Batch D 1/3 · Reports (boards M1/M2) *(2026-07-22)*

First Analyze-section (Batch D) fidelity increment — Reports.

- **Expenses render in neutral ink, not terra.** The all-time Expenses stat was
  styled `text-terra`, which breaks the design system's "Accidental Wealth" rule
  (CLAUDE.md): *crit is reserved for genuine failures — never for "money spent"*.
  The board shows the figure in plain ink; spend is information, not alarm.
- **Period selector is the board's segmented rail** (board M1 §`.srail`) — one
  sunken inset pill whose active segment is a raised accent-tinted chip,
  matching the Transactions type rail. Replaces the bordered control with the
  solid-coral active button.
- **Stat tiles follow board `.stat`** — neu tiles carrying a **delta subline**
  (`avg $870/month`, `kept 67%`, `over 12 months`) under each figure, and they
  **scroll as a carousel on phones** before settling into a row on wider
  screens. Replaces the bordered `<Card>` grid.
- **Needs-vs-wants gains its plain-language verdict** (board M2) — the bar's
  header now reads e.g. `90% needs — solid`, with descriptive (never scolding)
  thresholds: solid ≥70 · balanced ≥50 · wants-leaning ≥35 · mostly wants.

Also dropped two dead imports in `Reports.tsx` (`fmtSigned` was already unused
before this change; `Card` became unused here).

## v10.8.4 — Aurora fidelity · Batch C desktop · Debts/Net Worth/Accounts two-column layouts (boards D2/D3/D4) *(2026-07-22)*

The Plan section's **desktop** frames, which the M-frame passes (v10.8.0–v10.8.3)
didn't cover. Mobile/tablet layouts are unchanged throughout — every new block is
`lg:`-gated and the existing mobile renderings are now `lg:hidden`.

- **Debts · board D2** — desktop splits into payoff order (440px) + priority
  detail (1fr). The left column is a compact **numbered payoff list** (rank,
  kind glyph, APR / % paid, balance) with the priority outlined in the accent;
  the right column expands the selected debt: payoff ring, `Debt-free by <month>
  · $X cleared so far`, a four-tile **min pay / interest-per-month /
  principal-per-month / months-left** strip, Record payment, and the `?debtId`
  payments drill-through. **Clicking a numbered row moves that debt into the
  detail panel** (defaults to the priority); the "⚡ Pay this first" badge shows
  only for the actual priority debt.
- **Net Worth · board D3** — the waterfall hero and the four ratio tiles now sit
  **side by side** on desktop (`1fr · 340px`, ratios reflowing to 2×2 in the
  narrower column) instead of stacking; the balance sheet keeps its two columns
  below.
- **Accounts · board D4** — desktop splits into the wallet (1fr) + a **persistent
  ledger rail** (520px). Selecting a wallet card moves it into the rail, which
  shows the kind tile, computed running balance, the account's ledger, and an
  inline reconcile field that **speaks each kind's own language** — bank →
  "bank says" / Balance check, cash → "cash on hand" / Balance check,
  investment → "current value" / Update value — plus ★ Default · Edit · Archive.
  Reconciling still writes the account-level offset, never a transaction.

Not built (no data to back it honestly): the board's credit-card **cycle
utilization** panel (limit · statement · due · min) needs a credit-limit field
that `Account` doesn't carry — omitted rather than faked.

### Fixed
- **Accounts scrolled sideways on phones** once a household actually had
  accounts. The wallet grids declared `grid sm:grid-cols-2` with no explicit
  track below `sm`, so the implicit column sized to *max-content* and a wallet
  card could never shrink. Added `grid-cols-1`. Pre-existing since the wallet
  cards shipped; it stayed invisible in local-only previews because that seed
  carries no first-class accounts.

## v10.8.3 — Aurora fidelity · Batch C 4/4 · Accounts wallet strip + action language (board M5) *(2026-07-22)*

Final Plan-section (Batch C) fidelity increment — Accounts, completing Batch C:

- **Type-totals strip (board M5).** A four-tile strip — Bank · Cards · Invest ·
  Cash — leads the wallet, each showing that type's count and ledger-computed
  total (negatives in terra with an explicit "−"). Tapping a tile filters the
  wallet to that type; tap again to clear.
- **Per-type action language on each wallet card (board M5).** Every card now
  footers its own verb: bank/card → **ledger ▸**, cash → **balance check ▸**
  (honey), investment → **update value ▸**. Cash/investment open the reconcile
  input; the rest toggle the per-account ledger — replacing the row of generic
  icon buttons. The ★ default now reads "★ default — pre-fills Add Transaction".
- **Honest footer note:** "Balances are computed from the ledger — never typed
  over. ★ marks the default per currency." No money logic changed — the strip
  totals and card balances come from the same `computeAccountBalance` the page
  already trusts (a cash balance that nets its ledger proves it).

## v10.8.2 — Aurora fidelity · Batch C 3/4 · Net Worth waterfall + stale chip (board M4/D3) *(2026-07-22)*

Third Plan-section (Batch C) fidelity increment — Net Worth:

- **The equation is now a visual waterfall (board M4).** The hero replaces the
  text equation with three scaled bars you read at a glance — the full
  assets(+owed) bar, the slice liabilities take from it, and the net-worth
  remainder — over a denim spine, with net worth in neutral ink. Bar widths are
  the real proportions (liabilities and net worth as a share of gross assets).
- **Inline "update?" stale chip on aging balances (board M4).** A liquid/short
  asset not touched in 30+ days now carries a dashed-honey "update?" chip that
  opens its edit sheet — the same staleness rule that drives the mount-time
  toast, surfaced where you can act on it. Presentation only; no money changed.
- Removed dead `totalMonthlyDebtPayment` import/var that lingered unused on the
  page.

## v10.8.1 — Aurora fidelity · Batch C 2/4 · Debts strategy toggle + neutral balances (board M3/D2) *(2026-07-22)*

Second Plan-section (Batch C) fidelity increment — Debts:

- **On-page strategy toggle with an honest trade-off (board M3/D2).** Avalanche/
  Snowball is now a segmented control on the Debts page itself (was only
  changeable in Settings): switching resorts the priority list live and restates
  the real trade-off — "saves you $X in interest" / "$X more interest, but frees
  a balance sooner". The dollar figure is a genuine projection, not a guess.
  - Driven by a new **pure** `simulatePayoffInterest()` in `lib/calculations.ts`
    that runs the standard snowball/avalanche cascade (rolling freed minimums +
    the profile's extra payment) month-by-month in base currency and totals the
    interest paid. It's a forecast — it never touches stored balances or any
    aggregator, so the money-model invariants + golden file are unchanged
    (160/161; the 1 failure remains the pre-existing clock snapshot).
- **Balances render in neutral ink (board M3: "loss is information").** Total
  Debt and each debt's balance move from terra → neutral ink; honey still marks
  the monthly obligation, and terra is reserved for genuinely critical states.
  Debt-to-income keeps its healthy/watch/high semantic colour.

## v10.8.0 — Aurora fidelity · Batch C 1/4 · Budgets pace chart (board M1/M2/D1) *(2026-07-22)*

First Plan-section (Batch C) fidelity increment — Budgets, from the board-vs-shipped audit:

- **Cumulative-spend pace hero (board M1/D1).** The month hero is now the
  board's cumulative-spend-vs-limit chart instead of a flat progress bar: a
  filled coral area traces spend day-by-day, a dashed line marks the limit, the
  today dot sits at the current cumulative, and a dotted run-rate projection
  continues to month-end. Leads with **remaining** ("$X left of $limit"), the
  "$X/day keeps you green" sentence, an on-pace/watch/over status pill, a left
  accent spine, and the overall-usage trough beneath — with a
  "projected · lands $X under/over" axis note.
  - The chart is driven by a new **pure** `cumulativeSpendSeries()` in
    `lib/calculations.ts` that reuses the same `reportableTxns`/`effectiveDinero`
    machinery as `spendByCategoryInRange`, so the series endpoint can never
    contradict the tracked spend total. No money aggregator was modified; the
    invariant + golden suites are unchanged.
- **Add-Budget half-sheet restyled to the forms doctrine (board M2).** Replaced
  the pre-Aurora bordered scope-buttons + month/year/currency dropdowns with:
  period **chips** (next six months + two annual years, with the bound period
  always representable), one big **amount hero** for the total, and allocations
  as tappable neu rows with a "＋ Add category" row and the "Suggest" affordance.
  Footer is a single "Create budget · $X allocated" primary with the honest
  "$X stays flexible — allocate any time" note (or Delete on edit). All
  save/identity/BUDGET_EXISTS logic is byte-identical — presentation only.

## v10.7.1 — Aurora fidelity pass 7/× · bug batch (Transactions, Calendar, Add Transaction, Recurring, pip) *(2026-07-20)*

Six fixes from a direct board-vs-shipped review:

- **Today/Yesterday date-chip collision, fixed.** `today()` (`lib/format.ts`)
  computes via `toISOString()` (UTC); the form's `yesterdayStr()` used
  local-time getters. West of UTC during local early-morning hours the two
  bases could yield the **same string**, so both chips showed "on"
  simultaneously with no way to tell them apart or undo the selection.
  `yesterdayStr()` now shares `today()`'s UTC basis.
- **"All details ▾" disclosure removed from Add Transaction.** Member, split,
  and currency selection had already migrated to the main sheet in earlier
  passes, leaving only the Private checkbox behind the toggle — a one-item
  disclosure was pure friction. Promoted onto the main sheet, always visible.
- **Add Schedule (Recurring) restyled to match Add Transaction's theme.** The
  sheet still used the pre-Aurora bordered `Field`/`Input`/`Select` primitives;
  rebuilt with the same chip/mono-label/bare-amount-hero conventions (type
  chips, `AmountField`, `CategoryChip` grid, chip rows for owner/recurrence/
  weekday/monthly-mode/ends/reminder, the same inline switch used for Add
  Transaction's split toggle, single-primary-button footer). Logic
  (`save`/`buildRruleStr`/`populateFromSchedule`) untouched.
- **Pip logo gradient-id collision fixed.** `Brand.tsx`'s `<Pip>` used a
  literal `id="pip-grad"`; TopBar (desktop) and MobileHeader both mount a Pip
  at once, producing duplicate DOM ids — invalid HTML and a latent rendering
  hazard. Now unique per instance via `useId()`.
- **Transactions view brought closer to the board (M1/D1):** search + the
  calendar toggle now share the board's first toolbar row; the type rail
  gained board-styled **Filters** and **★ Views** chip triggers (replacing a
  bare icon button and a pre-Aurora bordered `SavedViewsBar`, which is now
  restyled to match); month-group headers are now the board's floating glass
  pill card with a small circular chevron toggle (was a full-bleed straight
  bar).
- **Transactions calendar (`TxnCalendar`) rebuilt to the board's `.cal` spec:**
  heat dots (opacity scaled to that day's spend vs. the month's peak) plus a
  sage income dot, replacing the old bordered/legend-swatch day cells with
  per-day amount labels. Future days with a firing schedule carry the board's
  `↻` mark. The desktop right-rail instance now renders as the board's
  described "mini heat calendar" (30px cells) via a new `mini` prop.

## v10.7.0 — Aurora fidelity pass 6/× · Batch B board D1 (Transactions desktop right rail) *(2026-07-18)*

- **Two-column desktop Transactions** (board D1 `1fr · 340px`): the list keeps
  the left column; a sticky right rail carries
  - a **month summary card** — the CURRENT month's true (unfiltered) In / Out
    / Net, computed by the same `monthlyData` aggregate the dashboard trusts;
  - the **heat calendar**, now permanently resident on desktop (day-tap still
    filters the list, projected recurring days still render).
- The Calendar toggle button and the toggled full-width calendar are now
  mobile/tablet-only — below `lg` nothing changes.
- **Transaction rows regain the account in the sub-line** ("Groceries · Today
  · Visa" per the board), resolved through the same `resolveAccount` path the
  old leading chip used — so the account info removed from the gutter in
  v10.6.7 is back where the board actually places it.

## v10.6.7 — Aurora fidelity pass 5/× · Batch B quick wins (Track rows, type rail, schedule sentences) *(2026-07-18)*

First Batch B (Track) fidelity increment, from the board-vs-shipped audit:

- **Transaction rows lead with the tinted category tile** (board B M1): 34px
  rounded-9 tile with neu-sm shadow and a 15% category-color tint; transfer/
  investment rows get their type glyph (🔄/📈) on a denim tint, and their
  sub-line names the type instead of a blank category. The payment-method chip
  no longer occupies the row gutter (the account stays visible in the edit
  sheet and via filters). Applies everywhere `TxnRow` renders (Transactions,
  Splits drill-ins).
- **Recurring transactions carry a compact ↻ glyph** next to the description
  (title = the recurrence), replacing the boxy "↻ monthly" text badge.
- **The type filter is the board's segmented rail** — one sunken inset pill
  containing All · Expense · Income · Transfer · Invest; the active segment is
  a raised accent-tinted chip. Replaces the loose neu-chip row.
- **Recurring schedules read as sentences** — rows now describe their rule via
  `describeRRule` ("Monthly on the 16th") when the schedule carries an rrule;
  legacy rows fall back to the plain frequency word (no more all-caps codes).

Remaining Batch B items: desktop Transactions right rail (board D1 two-column)
— next release; the full tap-to-edit sentence BUILDER for the recurring form
(board M6) is deferred — the current form already has full RRULE parity via
chips, the builder is a presentation upgrade tracked for a dedicated pass.

## v10.6.6 — audit finding #1: mobile Dashboard status banner never empty *(2026-07-18)*

From the Batch-A fidelity audit: board M1's signature status banner only
rendered when a current-month budget existed (it's a budget-pace nudge), so
budgetless users saw an empty slot between the pulse and the panels.

- Added a **fallback**: when there's no current-month budget but there IS
  this-month income, the banner shows a savings status instead — "✦ You've
  kept $X this month — Y% of income" (sage) or "✦ You've overspent $X this
  month" (honey). Uses only existing aggregates (no new money math). Null only
  when there's genuinely nothing truthful to say (no budget AND no income).
- Batch A fidelity audit otherwise clean: all screens verified at 375px +
  1280px, no overflow/clipping (the only such bug, the theme selector, was
  fixed in v10.6.5), correct responsive hiding, sheets at 720px centered on
  desktop.

## v10.6.5 — fix: desktop account-menu theme selector overflowed the dropdown *(2026-07-18)*

User-reported: the theme selector looked broken on desktop. Root cause — the
v10.6.4 theme `.mrow` put the icon tile + "Theme" label + three labeled chips
(Light/Dark/Auto) on ONE row; in the 300px anchored dropdown that row was
24px too wide, so the "Auto" chip was clipped by the glass-panel edge. (It fit
in the 375px mobile sheet, which is why it passed there.)

- Theme row restructured to **stack**: icon tile + "Theme" label on top, the
  segmented control full-width (chips `flex-1`) below. Fits any container
  width; verified the control sits fully inside the dropdown (246px inside a
  300px panel) and each chip is equal-width.
- Functionally verified end-to-end: clicking Light applies `data-theme="warm"`,
  Dark applies `dark`, and the checked chip tracks the active theme.

## v10.6.4 — Aurora fidelity pass 4/× · Batch A board M7 (Account menu) — Batch A complete *(2026-07-18)*

Finishes Batch A: the account menu is rebuilt to board M7.

- **Mobile → full-width top pull-down sheet** (board M7, same gesture family as
  notifications/household). Header = 46px person avatar + name + "email · role"
  ("Local-only mode · Owner" off-cloud). The account routes render as board
  `.mrow` cards (sunken-inset icon tile · label · chevron): Households ·
  Settings · Help & Guide. Theme is its own `.mrow` with the segmented control
  on the right. Sync status line, then **Sign out** in crit color (shown only
  when signed in).
- **Desktop → anchored glass dropdown** (the D-pattern) using the SAME body,
  widened to 300px to fit the card rows.
- **Dropped the redundant household-switch row** that used to live inside this
  menu — switching now lives solely on the household chip (TopBar on desktop,
  MobileHeader on mobile); this menu's "Households" row navigates to household
  management, matching the board.
- Conflict/mapping note: the board lists a separate "Profile & preferences" row
  above "Settings"; this app has no distinct profile page (profile lives inside
  Settings), so that row is folded into Settings rather than fabricating a
  duplicate destination. Flag for the Batch-A review.

**Batch A fidelity status:** M1/D1 (Dashboard+shell), M2/M3/D2/D3 (Notification
+ Household sheets), M4/D4 (Add-Transaction), M7 (Account menu) all shipped.
M6 (keypad-active) is intentionally skipped per the keypad-removal ruling; M5
(system-states tile) is a designed-state inventory already covered by the A6
toast/empty/EstimatedTag work — not a distinct screen.

## v10.6.3 — fidelity fixes (user-reported) + token audit + split toggle inline *(2026-07-17)*

Two pixel-fidelity bugs reported from prod, root-caused, plus the systemic
hardening they exposed:

- **"New household" dashed outline was invisible** — `border: 1.5px dashed
  var(--line2)` is INVALID CSS: `--line2` is an HSL triplet token, so the
  browser silently dropped the whole declaration. Fixed to
  `hsl(var(--line2))`. This failure class produces zero errors in any gate
  (tsc/eslint/build all pass), so:
  - **New binding rule in CLAUDE.md** ("Token usage rule") documenting the
    two token conventions and the required verification: computed-style
    checks on every newly styled decorative property + a pre-ship grep for
    unwrapped triplet tokens.
  - **App-wide audit run**: one match found across the entire src tree
    (PulseGauge's flagged line wraps at usage — false positive). No other
    instances.
- **Household sheet footer** ("Manage members & invites →") left-aligned per
  user direction (the board centers it; explicit feedback overrides).
- **Split toggle moved inline onto the Add-Transaction main sheet** (board
  M4): "↔ Split with someone · off — splits create IOUs" row with a real
  pill switch (sunken track, sage knob when on); the participant editor
  expands in place. Previously the whole split section hid behind
  "All details ▾".

## v10.6.2 — Aurora fidelity pass 3/× · Batch A boards M4/D4 (Add-Transaction) *(2026-07-17)*

Rebuilds the Add-Transaction sheet's presentation to board M4/D4 — around the
user's standing removals (no keypad, no currency selector, no note field; all
re-confirmed at the conflict checkpoint).

- **Type chips centered** at the top of the sheet (board M4 row).
- **Amount is bare on the sheet** — the inset field chrome around the amount
  is gone; 38px mobile / 40px desktop mono with the muted 24px currency
  prefix, exactly the board's `.amount` treatment (still a real editable
  input with the native decimal keyboard, per the keypad removal).
- **Category is a wrapped grid, not a scroller** — the 7 most-recent category
  tiles + a "⌕ More" tile that expands to the full type-scoped set ("▴ Less"
  collapses). The selected category is always kept visible in the collapsed
  set (edits of an older transaction surface its category in slot 7).
- **"Date · paid with" merged row** (board M4): Today/Yesterday chips, the
  native date+time pickers, and the source-account chips now share ONE
  labeled group ("paid into" for income, "from account"/"to account" wording
  for transfer/investment). The account-required marker and the
  add-accounts-on-Net-Worth tip carry over.
- **Member row moved out of "All details" onto the main sheet**, as initials
  chips per the board ("MR · You" style).
- **Footer** — one full-width 50px "Save expense/income/transfer/investment"
  primary button; "Save & add another" (create) or "Delete" (edit) is the
  quiet mono cap link centered below it.
- Known remainders flagged for the checkpoint: the split toggle still lives
  in "All details" (board M4 shows it inline on the main sheet), and the
  description field doesn't yet render the board's "suggested ✕" chrome
  (autosuggest itself already works via the datalist).

## v10.6.1 — Aurora fidelity pass 2/× · Batch A boards M2/M3/D2/D3 (Notification + Household sheets) *(2026-07-17)*

- **Household sheet (board M3/D3):** the active household card now carries the
  board's member AVATAR STACK — up to three overlapping member initials
  (coral-grad first, deterministic colors after, 2px canvas ring) — and the
  sub-line gains your role: "Family · USD · You're the owner". Honesty rule:
  only the ACTIVE household shows the stack (the store only holds its roster);
  other households keep their initials avatar rather than a fabricated one.
  Role falls back to "Owner" in local-only mode (single-user data).
- **Notification sheet (board M2/D2):** the list is inset so unread coral dots
  sit in a proper gutter left of the icon tiles, and READ rows now drop their
  tint — the icon tile flips to the sunken/inset treatment the board shows for
  handled items. (The sheet's structure — Today/Earlier groups, inline
  Approve/Skip/Review decisions, mark-all-read, settings footer, 720px desktop
  column — already matched the board from v10.1.)

## v10.6.0 — Aurora fidelity pass 1/× · Batch A boards M1+D1 (Dashboard + shell) *(2026-07-17)*

First screen of the board-fidelity project: the shipped design is being brought
up to the reference boards at `Vyact Redesign/design_handoff_vyact_aurora/
reference/boards`, batch by batch, with user checkpoints between screens.
Conflict rule: the boards are the spec, but anything the user explicitly
changed earlier (coral Ask, keypad/note/currency removals) stays until they
rule otherwise — each conflict is flagged as it's hit.

**Shell (board M1/D1):**
- New `MobileHeader` — phones lose the fixed glass top bar; a scrolling header
  row carries pip → home · greeting ("Good morning / {name}") on Home, section
  cap + page title elsewhere · household-TYPE chip → HouseholdSheet · bell ·
  30px avatar (opens account menu). `TopBar` is now ≥sm only.
- The avatar now identifies the PERSON (initials from the display name, per
  board "MR"), and the household chip shows the household TYPE with the house
  icon on both breakpoints — the name lives in the sheet, ending the
  name-shown-twice problem for good.
- `SubNav` → board treatment: mobile is the "Track ▸" accent cap + inset
  segmented bar (active segment = raised accent-tinted chip); desktop keeps
  the sticky bar with cap + 32px neu chips, active = inset + accent tint.
- Mobile tab bar: active tab sits on an accent-tinted pill (board .m-tab.on).
  Ask stays coral (user override of the board's denim).

**Dashboard (board M1/D1):**
- Cash-flow hero rebuilt to the board: left tone spine, "Cash flow · 6 months"
  cap, big signed net, "↗ N% kept" pill, and the 6-month trend INSIDE the card
  — scrubbable (tap/drag) with a pinned glass tooltip carrying an insight note
  ("✦ N% above/below your 6-mo average"), dashed month marker, month axis row,
  In/Out footer (+ Net worth link on mobile, savings rate on desktop).
- Net-worth hero (desktop): denim spine, big number, Assets/Liabilities row.
- Pulse block rebuilt as the board composite: conic-gradient ring (inset
  trough + neu core) beside/above the four component METER BARS
  (Budgets/Savings/Trend/Debt troughs with scores); mobile = bare
  ring-plus-meters row, desktop = titled "Family Pulse Score™" card.
- Desktop metric tiles (income/expenses/savings rate) with bottom accent bars;
  insights render as 2×2 spine-cards (tone spine + emoji headline + subline).
- Mobile pace banner: "You're on track this month — $X under budget pace"
  (pro-rated against the current-month budget; hidden when none exists —
  computed from existing aggregates only, board asks weekly which needs a
  weekly budget engine we don't have; flagged at checkpoint).
- Recent panel rows: board style — 34px tinted category tile, name +
  "category · when" mono subline, signed amount.
- Panels row is a 3-up on desktop (budgets · recent · spending donut).
- Dashboard h1 greeting is desktop-only (mobile greeting lives in the header);
  MiniPulse-next-to-greeting and the old sparkline are superseded.

## v10.5.5 — transaction form: date+time one row, native clock picker, currency selector removed *(2026-07-16)*

- **Date & time on one line.** The transaction form's Date row (Today /
  Yesterday chips + date picker) now also carries the time picker, in an inner
  non-wrapping group so the two pickers stay side-by-side even on a 375px
  sheet. The separate Time row in "All details" is gone.
- **Native clock time picker, consistent app-wide.** The custom hh:mm text
  input + AM/PM chips are replaced by a native `<input type="time">` — the
  same control Settings ▸ Notifications quiet hours already uses, and the one
  that renders as the platform's round clock selector on mobile. There is now
  exactly one way to pick a time anywhere in the app.
- **Currency selector removed from the transaction form.** Every new
  transaction records in the household's base currency; the chip row is gone
  from "All details". Editing a legacy foreign-currency transaction keeps its
  stored currency untouched (a small "Recorded in X; reports convert to Y"
  note appears instead of a control).
- Note: the user tested the v10.5.4 form-sheet conversions before that deploy
  finished — verified the deployed `BudgetFormModal` chunk on production
  already carries the HalfSheet `footer` API, so Add Budget/Debt/Asset/
  Account/Schedule are live as bottom sheets since v10.5.4.

## v10.5.4 — form-sheet consistency, coral identity color, transaction form cleanup *(2026-07-16)*

Five more issues reported after v10.5.3.

- **Transaction form:** removed the in-sheet numeric keypad and the optional
  Note field, per explicit feedback that neither pulled its weight. The
  amount field (`AmountField`, `components/ui/NumericKeypad.tsx`) is now a
  real text input (`inputMode="decimal"`) instead of a display-only span
  driven solely by the custom keypad — removing the keypad without this
  would have left no way to enter an amount at all. A `sanitizeAmount()`
  helper keeps typed/pasted input to a valid decimal (digits, one dot, max 2
  places) the same way the old per-keystroke `applyKey()` did. Existing
  transactions that already have a note keep it (nothing reads/writes
  `Transaction.note` outside this one form); only the ability to set a new
  one from this form is gone.
- **Reversed the v10.5.3 avatar/Ask-Vyact color call** — that release
  unified on `--rail` (the multicolor aurora gradient) reasoning from a
  CLAUDE.md aside about "avatars, focus flourishes." Explicit follow-up
  feedback: the household/account avatar and Ask Vyact should read as the
  same **coral** identity color as the rest of the brand, not a separate
  multicolor treatment. Added `--coral-grad` (the literal gradient already
  used in two places, now named once) and pointed `AccountMenu`'s avatar,
  `HouseholdSheet`'s avatar, and Ask Vyact's icon/text color (desktop chip +
  mobile tab) all at coral (`var(--coral-grad)` / `var(--accent)`).
- **Add Schedule / Add Budget / Add Asset / Add Account / Add Debt forms
  now match Add Transaction's presentation.** All five were still wrapped in
  the legacy `Modal` component (centered dialog, `bg-bg2`/`rounded-lg`, `X`
  close) instead of `HalfSheet` (bottom sheet on mobile, glass dialog on
  desktop, grabber, sticky footer) — a different container entirely, not a
  close match with different field styling. Swapped the wrapper on all five
  (`BudgetFormModal`, `DebtFormModal`, `AssetFormModal`, `AccountFormModal`,
  `Recurring.tsx`'s schedule form), extracting each form's trailing
  Delete/Cancel/Save row into `HalfSheet`'s `footer` prop the same way
  `TransactionFormModal` already does.
- **"Add Account" button didn't match the rest of the app's buttons** —
  traced to the shared `<Button>` React component still rendering its own
  legacy style (`font-mono uppercase`, flat `shadow-1`) instead of the
  `.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-danger` CSS classes
  (serif display font, normal case, neumorphic shadow) the rest of the app
  moved to during the Aurora pass. `<Button>` now maps `variant` straight to
  the matching `.btn-*` class, which fixes every one of its 10 consumers at
  once (Accounts, Households, Chat, Onboarding, WhatsAppLink, and the five
  form-sheet footers above) rather than patching each call site.
- **Reports "Needs vs Wants" bar — still investigating.** Confirmed the
  reporter is on the latest deployed build (checked the live production JS
  bundle directly — the v10.5.3 fix is present) and the underlying math is
  provably self-consistent (the percentage and the amounts shown below it
  come from the identical numbers in the same render, verified against both
  the demo dataset and the deployed bundle's source). Have not yet been able
  to reproduce the specific visual defect — screenshot capture is
  unavailable in this environment for this pass. Left open pending a closer
  look at the reporter's actual rendered numbers.

## v10.5.3 — household-type persistence, header redundancy, avatar/AI color consistency, verdict-bar robustness *(2026-07-16)*

Five issues reported after v10.5.2. Root-caused against real code/DOM behaviour
(not assumed); one item (Reports "Needs vs Wants" numeric mismatch) was
investigated and found NOT reproducible — see below.

- **Household Type silently reverted on reload (real bug, local-only mode).**
  Settings' "Household Type" field called `updateProfile({household})`, which
  patched the in-memory `households` list (so the UI looked correct for the
  rest of the session) but never called `adapter.updateHousehold()` — the only
  call that actually persists `HouseholdMeta.type` to storage. Cloud mode was
  already correct (`supabaseAdapter.updateProfile` writes `households.type`
  directly); local-only mode was not. `updateProfile` (`store/slices/dataSlice.ts`)
  now also calls `adapter.updateHousehold()` for `household`/`baseCurrency`
  patches — harmless no-op for cloud, the actual fix for local.
- **Household Type relocated from Settings ▸ Profile to Households ▸ Household
  Settings** — it's a property of the household record, not the user's profile,
  so editing it lived in the wrong place. Local-only mode (previously just an
  "enable cloud" banner with no household editing at all) now also gets a
  Household Settings panel (name + type) for its single on-device household.
- **Redundant household display on desktop.** `AccountMenu`'s dropdown carried
  its own household-identity row (added in v10.5.1 to fix a *mobile* bug, since
  mobile has no separate household chip) but it was never hidden on desktop,
  where the TopBar's persistent household chip already covers the same
  affordance — opening the avatar menu showed the household name twice at
  once. The row is now `sm:hidden`; mobile is unaffected.
- **Household avatar didn't match the app's own avatar convention.**
  `HouseholdSheet`'s per-household avatars correctly use `--rail` (the
  documented aurora gradient — CLAUDE.md: "avatars, focus flourishes"); the
  identical avatar in `AccountMenu` instead used a one-off solid coral
  gradient. Unified on `--rail` so the same household's identity color is
  consistent everywhere it appears.
- **Ask Vyact used the wrong semantic color.** Per the documented palette rule
  (`--plum` = forecast/AI, `--denim` = banking/info), the AI assistant's
  launcher (desktop chip + mobile tab) was styled with `--denim`. Switched to
  `--plum`, consistent with how `insight_fresh`/`trend_alert` notifications
  already tint themselves.
- **Reports "Needs vs Wants" bar hardened against rounding artifacts.** Traced
  the computation and verified live: the bar's percentage and the amounts
  shown below it always derive from the exact same numbers, so a genuine
  numeric mismatch isn't possible in this code path — confirmed with the
  reporter that the actual complaint was visual, not numeric. Hardened anyway:
  each visible segment now rounds its own outer corner explicitly (previously
  relied solely on the container's `overflow-hidden` to clip square corners
  into the pill shape) and the last segment fills via `flex-1` instead of an
  explicit percent width, so independent per-child pixel rounding can never
  leave a seam or bleed past the rounded ends.
- **Notification system audited** (13-type model): the 6 wired generators
  (`recurring_due_confirm`, `recurring_reminder`, `budget_threshold`,
  `debt_payment_due`, `income_landed`, `stale_balance`) fire correctly on every
  refresh, dedupe correctly, and their P1 web-push path is properly gated by
  the master toggle, per-type toggle, and quiet hours. Confirmed the remaining
  7 types (`recurring_posted`, `insight_fresh`, `trend_alert`,
  `member_activity`, `sync_conflict`, `invite_received`, `milestone`) are
  intentionally producer-deferred (documented since Batch A — they render in
  the sheet and Settings but have no generator yet, by design, not a bug).
  Generation logic is identical for desktop and PWA (no platform-specific code
  path); actual OS-level push delivery on an installed PWA needs verification
  on a real device, which is outside what this environment can exercise.

## v10.5.2 — graph animation follow-up (chart/bar/ring entrance motion) *(2026-07-16)*

Picks up the one item flagged "investigated, partially addressed" in v10.5.1: the
hand-rolled bars/rings across Dashboard/Budgets/Debts/Net Worth never animated on
load, and the Recharts-based charts animated with untuned defaults.

- **Root cause:** every bar/ring renders its final value directly from data via
  inline `style={{width}}`/`strokeDashoffset` on first paint. A CSS `transition`
  only fires on a subsequent VALUE CHANGE, never on initial mount — so the
  `transition-[width]`/`transition-all` classes already present on these elements
  were silently inert on page load.
- **Fix — `animation … backwards` fill-mode** (matches the design handoff's own
  `vy-grow`/`vy-ringfill` keyframe technique): the browser holds the keyframe's
  `from` value before paint, then animates to the element's own already-specified
  inline value as the implicit "to" state — no per-instance keyframe generation
  needed despite each bar/ring having a different target. Added `.chart-grow`
  (`vy-grow`, width 0→final, 0.8s) and `.ring-grow` (`vy-ringfill`,
  stroke-dashoffset from a `--ring-from` custom property, 1.1s) utilities to
  `index.css`, reusing the existing `--ff-ease-out` token.
- **Applied across every hand-rolled graph:** Dashboard's mini pulse ring +
  budget-progress bar; Debts' payoff bar + payoff-journey ring; Budgets' pace-hero
  bar, per-card overall bar, and per-category allocation bars (60ms stagger);
  Net Worth's liquidity stacked bar (3 segments, 60/120ms stagger); Reports'
  category breakdown bars (60ms stagger per row).
- **Recharts charts tuned** to the brand's motion feel: `animationDuration={900}`
  + `animationEasing="ease-out"` (the closest Recharts enum match to
  `--ff-ease-out`'s cubic-bezier — Recharts doesn't accept an arbitrary bezier
  string) on Reports' income/expense area chart, the saved-vs-overspent bar
  chart, and the category donut's pie.
- **Donut legend rows** now enter with the existing `staggerContainer`/
  `staggerItem` framer-motion variants (same vocabulary as the Dashboard KPI
  grid), replacing a static list with no entrance motion.
- Scope: chart/graph entrance animation specifically, as flagged in v10.5.1 —
  not a broader app-wide microanimation audit.

## v10.5.1 — post-Batch-E bug fixes (household switcher, notification settings, glass legibility, mobile Learn controls) *(2026-07-14)*

Five issues reported after Batch E shipped. All root-caused against real code/DOM
behaviour (not assumed) before fixing.

- **Household switcher from the avatar menu was broken.** `AccountMenu` embedded
  a legacy `ProfileSwitcher` dropdown whose own expanding list was clipped by its
  parent's `overflow-hidden` — it visually failed to show any options. Retired
  `ProfileSwitcher` entirely; the avatar's household row now opens the same
  `HouseholdSheet` pull-down as the TopBar chip (board M7: "same pull-down
  gesture family" — one working switcher, not two). The sync-status badge that
  lived inside the old dropdown is preserved as its own row in the avatar menu.
- **Notification settings were never implemented.** The data layer
  (`NotificationPrefs`, `updateNotificationPrefs`, quiet hours, per-type map) was
  already wired into the generators from Batch A, but no Settings UI existed to
  read or change any of it — the "Notification settings →" link pointed at a
  section that didn't exist. Added a full **Settings ▸ Notifications** panel:
  master toggle, all 13 types grouped and toggled (`sync_conflict` locked "always
  on" per spec), quiet hours, reminder lead time, and a browser-push toggle that
  requests permission before enabling.
- **Notification / account / household flyouts were too transparent to read.**
  The board's literal `--glass-strong` alpha (0.74 dark / 0.84 light) is tuned
  for the mockup's flat color blocks; against real dense financial typography it
  let numbers and headings behind the sheet bleed through legibly. Raised to
  0.97/0.97 (kept the blur + border, so it still reads as glass, not opaque) —
  verified with real financial data behind the sheet in both themes.
- **The Learn tab's Play/Text controls were unreachable on mobile**, hidden
  under the bottom tab bar. Root cause: `EvergreenReel`/`ForYouReel`/`ArticleReel`
  are full-screen overlays rendered as normal children of the routed page tree,
  which sits inside `<main className="... z-[1]">` (Layout.tsx). That z-index
  makes `<main>` its own stacking context — no z-index a *descendant* sets
  (however high) can ever outrank a true sibling of `<main>` like
  `MobileTabBar`/`AddFab`. Fixed by portalling all three reels to `document.body`
  with `createPortal`, escaping the trap entirely. Verified with
  `elementFromPoint` at the button's exact pixel before and after.
- **Dashboard Pulse gauge card** ("the centerpiece of the Dashboard," per its own
  comment) was still the pre-Aurora flat card — never converted during Batch A.
  Restyled to neu (`--elevated` + `--neu`, inset ring track) to match every other
  Dashboard tile.

**Investigated, partially addressed:** "microanimations and the graph experience
not matching the design" — Recharts' default entrance animation is present but
untuned to the board's `--vy-ease`/spring vocabulary, and the board's literal
SVG stroke-draw-in trick (`chart-line`/`chart-fill`) isn't implemented. This is
a broader, more open-ended chart-animation pass; flagged as a follow-up rather
than rushed against a shared chart component without full verification.

Gates: `tsc` 0, `eslint` 0 errors, `vitest` 160/161 (pre-existing clock
snapshot), `vite build` 0, money invariants unmoved (presentation + one bug-fixed
navigation path only — no money logic touched). Every fix above was verified
against real DOM/computed-style behaviour in a live browser, not assumed.

## v10.5.0 — Aurora Batch E: Profile + first-run (Auth · Help · Settings) *(2026-07-14)*

Fifth and final screen-level batch — the **Profile / first-run** surfaces restyled
to the batch-e board. Presentation only; auth, session, OTP-verification, and
household/RLS logic are unchanged (invariants green).

- **Auth:** `AuthShell` (shared by every auth screen — sign in/up, reset password,
  accept invite) is now a single **glass `auth-card`** on the aurora ambient
  background, with the **pip** mascot leading the wordmark. One edit point,
  every auth screen inherits it.
- **Help:** FAQ rows are the board's **`.faq`** — a neu accordion that deepens its
  shadow while open, with a rotating "+" affordance. Search, the support-ticket
  form, and all 9 topics are unchanged.
- **Settings → Appearance:** the theme picker is now **`.theme-thumb`** neu
  cards with a mini contrast-bar preview and an accent ring on the active theme.
- **Danger Zone reviewed, left as-is:** the account-deletion controls are already
  quarantined correctly (OTP-gated, red-accented only on the truly destructive
  action) — restyling it further risked the security path for no real gain.

**Tracked follow-ups (not in this batch):** the full grouped `.set-group` list
treatment across every Settings panel, the Households page's card grid + invite
half-sheet + role chips (the household **switcher** pull-down already shipped in
Batch A), and the Onboarding progress-ribbon/choice-card flow. These are larger,
logic-adjacent surfaces (RLS invites, onboarding state machine) better done as a
deliberate follow-up rather than rushed at the tail of this pass.

Gates: `tsc` 0, `eslint` 0 errors, `vitest` 160/161 (pre-existing clock snapshot),
`vite build` 0, money invariants unmoved. Verified in-browser: 9 neu FAQ cards
(open/close works), 3 neu theme thumbnails, and the sign-in screen renders the
pip + glass card — no runtime errors.

**This closes the planned Aurora batch sequence (A→E, v10.1.0→v10.5.0).**

## v10.4.0 — Aurora Batch D: Analyze (Reports · Insights · Ask Vyact) *(2026-07-14)*

Fourth screen-level batch — the **Analyze** section restyled to the batch-d board.
Presentation only; no aggregation, insight-feed, planner-rule, or on-device
assistant logic changed (invariants green).

- **Reports:** a **needs-vs-wants verdict split bar** (neu-inset track, sage/honey
  fill proportional to spend) replaces the two flat need/want boxes. Stat cards,
  the income/expense area chart, and every breakout table are unchanged.
- **Insights:** the For You / Learn / Plan switcher is now the board's **`.tri`**
  neu pill; the For You launch hero and preview cards (`.icard`) are restyled to
  neu with a hover lift. The reel (already rebuilt in v9.9.x) and Learn library
  are untouched — presentation is on-device, adds no financial math.
- **Plan (Planner):** recommendation rows are now **neu severity-spined cards**
  (colored left spine: terra/honey/denim by rule outcome) instead of a flat
  border-left row. Every recommendation still traces to one rule + one data
  point — zero AI, zero hallucination, unchanged.
- **Ask Vyact:** chat bubbles restyled to the board's **`.bub`** — user messages
  in accent-ink-on-coral, assistant replies in a neu canvas bubble, each with the
  correct corner-radius "tail." The on-device pipeline (normalise → extract →
  classify → resolve → phrase) is untouched — presentation only.

Gates: `tsc` 0, `eslint` 0 errors, `vitest` 160/161 (pre-existing clock snapshot),
`vite build` 0, money invariants unmoved. Verified in-browser: verdict bar +
"Needs vs Wants" label render, the tri-tab pill shows 8 neu insight cards, a real
chat round-trip renders 2 board-styled bubbles, the Plan tab shows 3 severity
cards — no runtime errors anywhere.

## v10.3.0 — Aurora Batch C: Plan (Budgets · Debts · Net Worth · Accounts) *(2026-07-14)*

Third screen-level batch — the **Plan** section, restyled to the batch-c board.
Presentation of already-computed values; the money model, reconciliation, EMI splits
and every aggregation are untouched (invariants green).

- **Net Worth:** neu **waterfall equation** hero (assets + owed − liabilities → net),
  a **liquidity stacked bar** (liquid / short / long), and the four financial-ratio
  tiles restyled to neu. Balance-sheet lists and the stale-balance reminder preserved.
- **Debts:** a **payoff-journey ring** on the priority debt (percent of principal cleared
  + projected debt-free month), neu summary tiles + debt cards, accent-ink priority badge.
  Record-payment still launches the pre-seeded Add-Transaction sheet (EMI split unchanged).
- **Budgets:** a **current-month pace hero** — cumulative spend vs limit with a
  plain-language daily allowance ("$X/day keeps you green — N days left", or an over-budget
  line). Budget cards restyled to neu. Container + allocations model unchanged.
- **Accounts:** account rows are now neu **wallet cards** in a grid, each with a kind glyph
  tile. The per-account ledger, the fix-balance / update-value **reconcile** (offset, never
  a transaction) and archive/default controls are all preserved exactly.

The add-budget allocation half-sheet and the ledger bottom-sheet are tracked as batch-C
follow-ups. Gates: `tsc` 0, `eslint` 0 errors, `vitest` 160/161 (pre-existing clock
snapshot), `vite build` 0, money invariants unmoved. Verified in-browser (waterfall,
liquidity bar, payoff ring, no runtime errors across all four surfaces).

## v10.2.0 — Aurora Batch B: Track (Transactions · Splits · Recurring) *(2026-07-14)*

Second screen-level batch — the **Track** section, restyled to the batch-b board.
Presentation + interaction only; all filter/split/RRULE logic, the money model, and
the Family Pulse computation are unchanged (invariants green).

**Transactions:**
- **Type chip-rail** (All · Expense · Income · Transfer · Investment) as the primary
  filter, replacing the buried dropdown.
- **Filter half-sheet** (board M2) — the four `<select>` filters (type / category /
  month / member) are now neu **chip groups** in a `HalfSheet`, and the apply button
  previews the live result **count + net** before you commit.
- **Sticky glass month headers** — the month-group accordion headers are now glass
  (`--glass` + blur) so they read as a distinct layer while rows scroll under them.
- The deep-link context pill, calendar, saved views, pagination and projected-recurring
  rows are all preserved as-is.

**Splits:**
- **Who-owes-who hero** (board M4) — a single neu card leading with your **net position**,
  then the two sunken sub-tiles (Owed to you / You owe). Replaces the two flat cards.
- Split rows restyled to neu; the always-on explainer banner is gone — its guidance now
  lives in the (Pip-free) empty state. Settle / Mark-paid / Track-as-debt behaviour is
  unchanged (settling marks the IOU paid — it does NOT mint a settlement transaction,
  which would double-count against the split money model).

**Recurring:**
- **Upcoming-7-day strip** (board M5) — a horizontal rail of neu cards for every schedule
  due in the next week, each with a category glyph, amount, and a **countdown badge**
  (Due today / Tomorrow / in N days; honey-tinted when ≤ 1 day).
- The RRULE schedule form (daily/weekly/monthly-DOM/monthly-Nth/annual + ends + reminder
  + auto-confirm) is preserved. The board's tap-to-edit **sentence-builder** and the
  calendar pull-down layer are tracked as Batch-B follow-ups.

Gates: `tsc` 0, `eslint` 0, `vitest` 160/161 (pre-existing clock snapshot), `vite build`
0, money invariants unmoved. Verified in-browser (chip-rail, glass headers, filter sheet
with 34 chips, upcoming strip).

## v10.1.2 — Aurora Batch A shell fixes (pull-down sheets, avatar, add-FAB) *(2026-07-14)*

Bug-fix pass on the v10.1.0/v10.1.1 shell, from board review. Presentation only.

- **Pull-down sheets rendered empty (notifications + household switch).** The
  `PullDownSheet` body used `flex-1` (flex-basis:0) inside a content-sized,
  `overflow-y-auto` panel, which collapsed it to ~0px and clipped ALL content —
  the notification list/empty-state and the household cards were in the DOM but
  invisible, so both sheets looked broken. Fixed: the body is now `min-h-0`
  (sizes to content, scrolls only once the sheet hits its 92dvh cap) and the
  sheet is top-aligned (`items-start`). Both sheets now show their content.
- **Account avatar didn't match the theme.** It used the jade→indigo→violet
  rail gradient; the board's `.avatar` is the pip-coral gradient. Swapped to
  `linear-gradient(135deg,#F4B6A8,#E26D5C)` with dark accent-ink initials.
- **Mobile "+" add wasn't prominent.** Brought to the board's `.add-circle`
  spec: 54px (was 48), `translateY(-16px)` so it floats above the bar, coral
  fill with a coral glow shadow, dark-ink glyph, no border.

Gates: `tsc` 0, `eslint` 0, `vitest` 160/161 (pre-existing clock snapshot),
`vite build` 0, money invariants unmoved. Verified in a real browser (both
sheets open/close and render content; avatar + add-FAB geometry confirmed).

## v10.1.1 — Aurora Batch A shell chrome to board spec *(2026-07-13)*

Follow-up patch that brings the app-shell **header and footer** to the Batch A board
(`reference/boards/batch-a`, frames M1/M7/D1). v10.1.0 built inside the v10.0.0 shell but
inherited its nav chrome; the board actually refines it. No logic/money/route changes.

- **Mobile footer** is now the board's 5-slot tab bar: **Track · Plan · [ + ] · Analyze · ✦ Ask**
  — the primary **+ Add sits dead-center** (opens the Add-Transaction sheet) and **✦ Ask** is the
  far-right slot (opens the Ask drawer). "Home" moved to the header pip and "Profile" to the
  header avatar, so they are no longer tabs.
- **Desktop header** gains the **✦ Ask chip** and adopts the board order:
  Jump-to ⌘K · ✦ Ask · bell · household · avatar.
- The floating FABs are folded in: the **Ask** FAB is retired (now header chip + tab slot); the
  **Add** FAB is **desktop-only** (mobile uses the center tab). Ask is now a store-owned drawer
  (`askOpen`/`openAsk`/`closeAsk` in `modalSlice`) so both launchers open the same surface.

Gates: `tsc` 0, `eslint` 0, `vitest` 160/161 (pre-existing clock snapshot), `vite build` 0,
version-drift 0.

## v10.1.0 — Aurora Batch A: notifications, household switch, amount-first entry, home polish *(2026-07-13)*

First screen-level batch on top of the v10.0.0 Aurora shell. **All business logic, data
models, routes, the money model, and the Family Pulse computation are unchanged** — this is
presentation + interaction, plus one new synced entity (notifications). The Money-Model
invariant + golden suites stay green (presentation-only; no figure moved).

**Cross-device notifications (new synced entity):**
- Notifications graduate from local-only to a **household-scoped Supabase entity**
  (`notifications` table + RLS: read = member or `is_admin('roles')`, write = member;
  `unique(household_id, dedupe_key)`; retention purge dismissed > 30 d / read > 90 d).
  Migration `20260709120000_v101_notifications_sync.sql` (applied to prod).
- `notifySlice` now generates locally, upserts to cloud (dedupe on `household_id,dedupe_key`),
  fetches + purges on refresh, and falls back to per-household localStorage in local-only mode.
  Read/dismiss/mark-all are optimistic then synced. Refresh is wired from data/recurring/
  household-switch.

**13-type notification model + full-screen sheet (A2/A3):**
- `Notification` extended to the 13-type spec model (`priority` P1/P2, inline `actions`,
  `deepLink`, `amountRef`, per-entity refs, `dedupeKey`). Six generators produce the types
  whose source data already exists (recurring due/reminder/posted, budget threshold, income
  landed, debt due, stale balance, invite, sync conflict, insight fresh); the detection-engine
  types (trend, member activity, milestone) render but are producer-deferred.
- New `NotificationSheet` — a full-width **pull-down** glass sheet (Today / Earlier groups,
  P1 pinned first, inline per-type decision buttons that execute in place, mark-all-read,
  "All caught up" + pip empty state). The bell (`NotificationCenter`) opens it and shows the
  active-household unread count.

**Household switch pull-down (A4):**
- `HouseholdSheet` — a pull-down of household cards (active glows coral + accent ring),
  "New household", and "Manage members & invites →". The TopBar household chip opens it;
  switching reuses `switchHousehold`.

**Amount-first Add-Transaction half-sheet (A5):**
- `TransactionFormModal` presentation rebuilt on the forms-doctrine `HalfSheet`
  (bottom sheet on mobile / centered glass dialog on desktop, single responsive panel):
  amount-first with an in-sheet **numeric keypad**, **chips instead of dropdowns** for
  type / category (recents-first) / date (Today·Yesterday·pick) / account / currency / member,
  autosuggested description, an **"All details ▾"** disclosure, and **Save + "Save & add
  another"**. **Reuses `upsertTransaction` and the transfer/investment swap matrix byte-for-byte**
  — the money path is unchanged; only the presentation is new. `N` shortcut unchanged.

**Home polish + system states (A6):**
- Dashboard heroes restyled to neumorphism and made a **swipeable full-bleed carousel** on
  mobile; Cash-Flow hero gains an inline **6-month net-flow sparkline**; a glanceable **Pulse
  ring** sits beside the greeting; friendly empty states use the **pip** mascot.
- Toasts gain an optional **action slot**; the Add-Transaction flow offers **Undo** on a
  freshly-added plain expense/income (system-split rows — loan EMI / transfer / investment /
  people-split — are intentionally excluded, since they create linked legs that must not be
  one-tap-reversed).
- Motion: sheet exits are opacity-only (avoids a transform-exit stall inside `AnimatePresence`);
  the mobile grabber / desktop ✕ are real close controls.

**Known tech debt (tracked, not shipped):** the Playwright e2e suite still targets the
pre-Aurora DOM and was already substantially red on `main` after v10.0.0 (the FAB now collides
with the legacy "+ Add Transaction" button; the e2e seed predates the v9.1 budget model). The
redesigned form is proven in real Playwright for the core edit/delete flow, and the Page Object
+ component test hooks (`data-testid` on chips, correct keypad "Backspace" label, input
`aria-label`s) are a down-payment. A full e2e migration to the Aurora DOM is deferred until the
remaining redesign batches (B–E) ship. Non-Playwright gates are green: `tsc` 0, `eslint` 0,
`vitest` 160/161 (the one failure is the pre-existing clock-dependent money snapshot, identical
on a clean tree), `vite build` 0, money invariants unmoved.

## v10.0.0 — "Aurora" full interface redesign (desktop + mobile) *(2026-07-09)*

Complete visual + navigation redesign to the **Aurora** direction from the claude.ai/design
handoff bundle (`Vyact-handoff/…/design_handoff_vyact_aurora`). **All business logic, data
models, routes, and features are preserved** — only the presentation layer and the nav shell
changed. Major version because the entire interface and navigation paradigm is new.

**Design language — Neumorphic Fluid / Aurora:**
- Cool nocturne base (deep teal-slate) with a jade/cyan/indigo/violet accent spectrum;
  **pip coral stays the primary accent**. **Dark ("Nocturne") is now the default theme**;
  the light theme ("Mist") keeps the stored `warm` attribute key so existing user prefs
  survive. Soft dual-light **neumorphism** for cards/buttons/inputs/nav pills;
  **glass** (blur + translucency) reserved for the command palette, account dropdown,
  and popovers. Signature **aurora rail gradient** (jade→indigo→violet) runs as a 3px strip
  atop the app bar and fills avatars.
- **Type:** Outfit (display/headings — replaces Newsreader), Inter (UI/body — replaces
  Inter Tight), JetBrains Mono for every figure (unchanged). `.display-italic`, `.num`,
  `.mono-label`, `.panel`, `.btn-*`, `.input` class names kept — their definitions were
  re-skinned, so every page inherited the redesign without call-site edits.
- **Token architecture:** both legacy token layers (Tailwind HSL slots + `--ff-*`) were
  remapped to Aurora values in `index.css`, plus new Aurora primitives (`--neu*`,
  `--glass*`, `--rail`, `--ambient`, `--accent`). Category colors kept per handoff §4.7.
  Ambient aurora glow replaces the old blueprint-grid backdrop.

**Navigation — desktop (≥640px):** the left sidebar is gone. New top-anchored shell:
- Sticky **glass app bar**: rail strip · pip + Vy·act wordmark · **Track / Plan / Analyze**
  sliding-pill section tabs · "Jump to… ⌘K" search · notification bell · account menu.
- **Contextual subnav** — neu pill row of the active section's routes, sticky under the bar.
- **⌘K command palette** (glass modal): quick actions (Add transaction / New budget /
  Ask Vyact) + every route grouped by section, fuzzy filter, full ↑/↓/↵/Esc keyboard support —
  the guarantee that all functionality stays reachable.
- **Account menu**: avatar pill on the rail gradient → glass dropdown with the household
  switcher (ProfileSwitcher retained wholesale — switching, sync status, manage), the three
  Account routes, a Light/Dark/Auto theme control, and sign out.
- Section ↔ route map (no route lost): Track = Dashboard·Transactions·Splits·Recurring;
  Plan = Budgets·Debts·Net Worth·Accounts; Analyze = Reports·Insights; Account menu =
  Households·Settings·Help. Template/flag-based page visibility (the old Sidebar rules)
  is enforced in the subnav, palette, and tab bar via a shared `navModel.ts`.

**Navigation — mobile (<640px):** native-feeling shell — slim glass top bar (pip · search ·
bell · account) + **bottom tab bar** (Home / Track / Plan / Analyze / Profile, active tab on
an accent pill, ≥44px targets, safe-area padded); a section's secondary routes stay reachable
through the same subnav pill scroller. `Sidebar.tsx` and `MobileBar.tsx` were deleted;
new: `TopBar`, `SubNav`, `CommandPalette`, `AccountMenu`, `MobileTabBar`, `Brand`, `navModel`.

Verified in-browser this release (local mode, both themes, desktop + mobile viewports):
shell renders, ⌘K opens/filters/executes (quick action confirmed by the Add Budget modal
opening), section pill slides and syncs with routes, subnav switches per section, account
menu theme control flips Nocturne↔Mist live, bottom tabs navigate, FABs clear the tab bar.

## v9.9.3 — Browser-verified fixes: blank-app on widget failure, reel counter, button contrast *(2026-07-04)*

Full in-browser verification of the v9.9.2 flip-card flow (mobile viewport, real click-through
of every interaction) surfaced three real defects, fixed here:

- **CRITICAL: the app rendered a permanently blank screen if the Userback feedback widget
  failed to load.** `main.tsx` gated `createRoot().render()` behind a top-level
  `await Userback(...)` — any widget failure (adblocker, corporate proxy, unauthorized domain,
  vendor outage) rejected the module and React never mounted. The widget is now fire-and-forget
  with a swallow-on-error: the app always renders; feedback is best-effort.
- **Reel progress indicator overflowed the screen.** The per-card dot column drew 117 dots
  (one per lesson + end slide) — taller than any phone viewport, colliding with the flip-back
  control. Replaced with a compact centered `n / 116` counter pill in both reels.
- **"Text" button was nearly invisible on light backdrops.** Its white-ghost styling assumed a
  dark photo behind it, but `object-contain` letterboxing puts theme-cream behind the controls.
  Now a solid `btn-secondary` surface, readable over any infographic or letterbox.

Verified in-browser this release: full-screen reel (375×812), un-cropped `object-contain`
infographic, title scrim fade-in on tap + 4s auto-hide, flip settling at 180° in ~400ms with
zero overshoot (sampled frame-by-frame), video autoplay on flip and full unmount on flip-back
(no ghost audio), text face, no-media fallback face, swipe-to-next, and both FABs absent
under `/insights`.

## v9.9.2 — Flip-card detail view: fixes cropping, redundant blocks, and distracting FABs *(2026-07-04)*

User-tested v9.9.1 against real screenshots and flagged concrete defects, all fixed here:

- **Infographic was cropped, unreadable.** The image used `object-cover` (crop-to-fill) on a
  portrait image taller than the viewport. Switched to `object-contain` — the full image is
  always visible now, letterboxed rather than cut off.
- **Redundant blocks removed**: the inline click-to-play video placeholder in the text reader
  (dead once you'd already reached text), the icon/stat/diagram graphic repeated at the top of
  the text reader (redundant with the infographic already shown), and the separate Share/Save/
  close controls duplicated in a second full modal — all gone.
- **New interaction model — a flip card, not a stacked action bar.** New
  `FlippableCardDetail.tsx` (shared by `EvergreenReel`/`ArticleReel`): front face is the
  infographic (or the code-visual fallback) with a title + dark scrim that auto-hides after 4s
  and reappears on tap; two minimal controls — **Play** and **Text** — flip the card (a real
  3D `rotateY` transition, reusing the shared `spring` from `lib/motion.ts`) to a back face
  showing the autoplaying video or the article body; a rotate/back control flips back to the
  front. Share/Save intentionally stay on the grid tile only, not duplicated in the detail view.
- **Retired**: `EvergreenReader.tsx`, `FullScreenVideoOverlay.tsx`, `YouTubeShort.tsx` — all
  superseded by the flip card's back faces.
- **Floating Ask Vyact / Add-Transaction buttons now hidden under `/insights`** — extended the
  existing `FloatingTools.tsx`/`AddFab.tsx` route-hide gate (already hiding during onboarding)
  so they don't compete with the focused, full-screen card-reading experience.

## v9.9.1 — Portrait infographics as the universal card viewer *(2026-07-04)*

Every Insight card/article now opens through one unified, swipeable full-screen viewer instead
of a lightweight text modal, following up directly on v9.9.0's video shorts:

- **`EvergreenReel.tsx`** (Learn tab) and the new **`ArticleReel.tsx`** (What's New tab) are now
  the *only* way any card/article opens — grid taps, the feed's deep-link, all of it. A card
  with an admin-uploaded infographic shows it full-bleed portrait with a bottom action bar
  ("Watch video" if a short is linked, "Read article", Share, Save); a card **without** one
  falls back to the original code-visual + teaser + Read layout — no dead ends.
- **New `FullScreenVideoOverlay.tsx`** — "Watch video" opens the short full-screen (fills the
  viewport, autoplays, portrait on mobile) with an "Open in YouTube" link, layered over the
  infographic rather than replacing it.
- **Removed the small video play-badge** from `CardVisual.tsx` and the analogous icon from the
  What's New grid tile — no longer meaningful now that every card routes through the same
  viewer regardless of what media it has.
- **`lib/insightVideos.ts`** generalised from `fetchEvergreenVideoLinks` (video-only) to
  `fetchEvergreenMedia` (video + infographic in one read); `EvergreenCard`/`InsightArticle`
  both gained `infographic_url`/`infographicUrl`.
- **DB migration**: `supabase/migrations/20260704120000_v991_insight_infographics.sql` — adds
  `content_items.infographic_url`/`infographic_updated_at`, plus the app's **first Supabase
  Storage bucket** (`insight-infographics`, public read, `is_admin('content')`-gated write) so
  admin can upload real image files (see admin v1.3.1). Applied to the live Supabase project.

## v9.9.0 — YouTube short videos on Insight cards/articles *(2026-07-02)*

Every piece of Insights content — the 116 evergreen cards, editorial articles, and curated
external items, all rows in `content_items` — can now carry an optional YouTube short. No video
files are stored in Vyact: only a URL + a last-updated timestamp, admin-authored in the Content
CMS (see admin v1.3.0). YouTube is the CDN.

- **Rendering:** `CardVisual.tsx` shows a small play-badge overlay on cards that have a video
  (code-rendered icon/stat/diagram visual is untouched — video is additive, not a replacement).
  `EvergreenReader.tsx` and `WhatsNew.tsx`'s article reader both gained a new
  **`YouTubeShort.tsx`** component: click-to-play (no autoplay iframe sitting in the DOM by
  default) plus an explicit **"Open in YouTube"** link so users can like/comment/subscribe on
  the actual video.
- **New `lib/youtube.ts`** — normalises any URL shape (`watch?v=`, `/shorts/`, `youtu.be/`,
  already-embed) to a video id, and builds both a privacy-enhanced `youtube-nocookie.com` embed
  URL and the canonical watch URL for redirection.
- **Evergreen cards are bundled JSON, not DB rows the client reads directly** — but the DB seed
  for all 116 cards already exists in `content_items` (same `slug` as the JSON's `id`). New
  **`lib/insightVideos.ts`** does one small `content_items` read (`slug, video_url` where
  `format='card'`) and merges it onto the bundled cards at runtime in `EvergreenLearn.tsx` — no
  changes to the JSON asset itself, no new table.
- **`InsightArticle`/`insightsApi.ts`** gained `videoUrl`, selected directly off `content_items`
  for the What's New tab (articles/external items aren't bundled, so no merge step needed there).
- **DB migration**: `supabase/migrations/20260702120000_v99_insight_video_shorts.sql` — additive
  `content_items.video_url` / `video_updated_at` columns. Applied to the live Supabase project;
  existing row-level RLS policies already cover the new columns (no policy changes needed).

## v9.8.2 — Danger Zone mobile fix, real "last updated" dates, working support contact *(2026-07-01)*

Three follow-up fixes on top of v9.8.1:

- **Mobile overflow fix** — the "Delete immediately instead" link next to "Schedule deletion
  (30-day undo)" in Settings → Danger Zone forced its row wider than the card on narrow viewports,
  pushing it outside the container. The button row now wraps (`flex-wrap`) instead of forcing a
  single line.
- **"Draft scaffold" labels removed** — Settings → Legal & Policies previously showed a static
  "Draft scaffold" tag under all three legal doc links, left over from before they were rewritten
  in v9.7.x/v9.8.0. Each card now shows a real "Last updated {date}" sourced from
  `Privacy.tsx`'s exported `POLICY_VERSION`, so the three surfaces (the doc pages themselves, this
  card, and any future version bump) can't drift out of sync.
- **Contact support was a dead end — now it isn't.** All three legal docs referenced "Help →
  Contact", but Help had no such section; there was no way to actually reach support from a legal
  page. Added a real "Contact support" panel to `Help.tsx` (anchor `#contact`) with a subject/
  message form that opens a pre-filled `mailto:` to a temporary support inbox
  (`uday.kr27@gmail.com` — flagged as temporary, to be replaced by proper ticketing as volume
  grows), and updated the Privacy/Terms/Cookies Contact sections to link directly to a working
  `mailto:` (so it works even for signed-out visitors reading the docs from an external link) in
  addition to the in-app form for signed-in users.

## v9.8.1 — Real Privacy Policy/Terms/Cookies + data erasure, deactivation, and account deletion *(2026-07-01)*

The Privacy Policy, Terms of Service, and Cookie Policy were "draft scaffold" placeholders with no
enforced acceptance. This release replaces all three with detailed, consistent legal content
(IP-rights and consumer-PII terms) and makes acceptance a real, recorded event at sign-up, plus
ships the data-control rights the new policies promise:

- **Privacy Policy** (`Privacy.tsx`) — collection/use/sharing/legal-basis sections, explicit
  Section 7 defining exactly what "erase", "deactivate", and "delete" do, and Section 8 covering
  reactivation.
- **Terms of Service** (`Terms.tsx`) — added a full Intellectual Property section (Vyact's IP,
  license grant, restrictions, ownership of *your* content with a narrow processing license,
  feedback license), acceptable use, no-advice, billing, termination, and liability sections.
- **Cookie Policy** (`Cookies.tsx`) — a real storage-category table (necessary / preferences /
  functional / analytics) with retention and opt-out guidance.
- **Sign-up consent** — a required "I agree to the Terms / Privacy / Cookie Policy" checkbox now
  gates both the email form and Google OAuth sign-up. Acceptance is recorded as
  `profiles.tos_accepted_at` / `privacy_accepted_at` (+ version) at the moment the account is
  created — not just a UI checkbox with no backend record (`lib/auth.ts` `acceptPolicies`,
  wired through `SignUp.tsx` and, for the OAuth-redirect / email-verification-pending paths, a
  `pending_policy_accept` flag consumed by `AuthGate` on session hydration).
- **Erase all household data** (Settings → Danger Zone) — `erase_household_data(h_id)` RPC
  (owner/admin-gated, `security definer`) permanently deletes every transaction, budget, debt,
  asset, account, goal, recurring schedule, and saved view for a household, and clears its
  onboarding baseline — while the household shell and memberships (and your login) survive.
  Requires typing `ERASE` to confirm; irreversible.
- **Deactivate account (temporary)** — `deactivate_my_account()` RPC sets `profiles.deactivated_at`
  and signs the user out immediately. No data is touched. The account self-reactivates the next
  time the user successfully signs in — `AuthGate` calls `reactivateIfNeeded()` on every session
  hydration, which clears the hold and surfaces a "Welcome back" toast automatically.
- **Delete account (permanent)** — `request_account_deletion()` RPC schedules deletion 30 days out
  (`deletion_scheduled_for`) and immediately places the same hold as deactivation, so signing back
  in during the window cancels the deletion via the identical reactivation path. The actual hard
  delete (all owned households' data + the `auth.users` row) is performed by a new service-role
  edge function, **`supabase/functions/delete-account`**, since dropping an `auth.users` row is not
  possible from an RLS-scoped client connection. An "delete immediately" escape hatch
  (`executeAccountDeletion(true)`) skips the grace window for users who explicitly ask to.
- **DB migration**: `supabase/migrations/20260701120000_v98_privacy_deletion_controls.sql` — adds
  `profiles.tos_accepted_at/tos_version/privacy_accepted_at/privacy_version/deactivated_at/
  deletion_requested_at/deletion_scheduled_for`, plus the four RPCs above. **Applied to the live
  Supabase project** (`vyact`, `dmxqkvploojokffuhxnz`) — confirmed via `get_advisors` with no new
  lint findings.
- **`delete-account` edge function deployed** to the live Supabase project (JWT-verified,
  service-role) — `executeAccountDeletion()` has a working backend, not just client code.
- **Legal docs made truly public** — `/privacy`, `/terms`, `/cookies` added to `AuthGate`'s
  `PUBLIC_ROUTES` (sign-up/login is not a gate to read them) and, in `App.tsx`, now render
  **before** the authenticated `AppShell` loading gate. Previously a signed-out visitor or crawler
  hitting these URLs in cloud mode would see an indefinite "Loading…" spinner (`loading` only
  resolves once `init()` runs, which never happens without a session) — they're now rendered
  standalone, immediately, without the app chrome.
- **Email-code re-authentication before every Danger Zone action** — erase / deactivate / request-
  deletion / delete-immediately now all require entering a one-time 6-digit code sent to the
  account's own email (`lib/auth.ts` `sendAccountActionCode` / `verifyAccountActionCode`, built on
  Supabase's native email-OTP `signInWithOtp` + `verifyOtp`) before the action executes — a merely
  signed-in/idle browser session is no longer sufficient to trigger an irreversible action.

## v9.7.1 — Hide the FABs during onboarding *(2026-06-23)*

The Ask Vyact and "+ Add Transaction" floating buttons (`FloatingTools` / `AddFab`,
mounted in `Layout`) showed over the full-screen onboarding overlay — `/onboarding`
is a route inside `Layout`. Both now return null on `/onboarding` (and `/auth/`):
`AddFab` already gated `/auth/`; `FloatingTools` gained a `useLocation` gate. No
household context exists during onboarding, so neither FAB applies.

## v9.7.0 — Onboarding redesign: the questionnaire now drives the dashboard *(2026-06-23)*

Closes the "inert ending" — a first-time user used to type cash / debt / income / fixed
costs, see a "picture," then land on an **empty** dashboard (the inputs were discarded,
`baselineCount = 0`; `segment.visibleModules` and `primaryConcern` were read nowhere).

Now the steps-3–4 inputs are kept as an **estimated *reference* baseline** on
`households.onboarding` (jsonb, already cross-device synced) and rendered on the dashboard
from minute one — a **reference overlay, not ledger rows** (injecting fake transactions
would break the money model; the band is clearly `EstimatedTag`'d).

- **`StartingBaselineBand`** (new, top of Dashboard): Net position (cash−debt) · Monthly
  income · Est. debt · Fixed-costs-to-budget. The lead **CTA adapts to the stated concern**
  (debt → Debts, runway → Transactions, else → Budgets).
- **It wipes** once real activity supersedes it — auto-graduates at 5 logged transactions,
  or on dismiss (`clearBaseline`, cross-device). Reference-only; never becomes ledger data.
- **Segment → module template** (`updateProfile({ template })`): individual → Single,
  household → Family, smb → Self-Employed — so the Sidebar's `pagesForTemplate` finally
  matches the customer type (business loses Splits/Members, etc.). Previously every segment
  got the same "family = all modules" dashboard.

No money-model change (band is overlay-only; INV suite untouched). No DB migration (additive
jsonb field). Builds on v9.6.1's removal of the discarded "Save for a goal" concern.

## v9.6.1 — Onboarding: drop the discarded "Save for a goal" path *(2026-06-23)*

Goals were removed as a module (v8.8.0), so the onboarding **"Save for a goal"**
primary-concern chip pointed at a surface that no longer exists. Removed it (concerns
are now Track spending / Pay off debt / Extend runway) and stripped the dead `'Goals'`
entry from both segments' `visibleModules`. Retired the `'savings'` primaryConcern
mapping (no concern produces it now; `'runway'` still falls through to `'spending'`).
No functional dashboard change — these onboarding signals were already inert; this
removes the goal association only.

## v9.6.0 — Motion design: framer-motion foundation + Tier 1 + Dashboard *(2026-06-23)*

Added **framer-motion** and a shared motion vocabulary, then converted the
highest-impact surfaces. Tone is brand-calm — soft springs, ≤260ms, small travel,
amounts **settle without overshoot**. Fully accessible: `<MotionConfig
reducedMotion="user">` at the app root makes the **whole app honor the OS
reduce-motion setting** automatically (previously only the Pulse gauge did).

**Foundation**
- `lib/motion.ts` — one house spring + a small variant set (dialog / popover /
  banner / toast / stagger), reused everywhere so motion reads designed.
- `<AnimatedMoney>` — count-up that reuses `<Money>` formatting, settles exactly on
  the figure, and is an instant set under reduced motion.

**Tier 1 — exit animations (the real gap framer-motion fills)**
- **Modals**: backdrop cross-fade + panel spring; now animates **out**, not just in.
- **Toasts**: rise/fade in + out, with `layout` so the stack slides up to fill gaps.
- **Dropdowns/popovers**: the ProfileSwitcher menu and the Transactions filter
  popover scale from their anchored edge, in and out.
- **SyncHealthIndicator** banner: slides up in / down out.

**Dashboard**
- The **Cash Flow** and **Net Worth** hero figures + the Income/Expenses KPI tiles
  **count up** on load/refresh; the KPI grid and insight chips **stagger** in.

Dependency: `framer-motion ^12.40.0` (+ lockfile).

## v9.5.11 — Evergreen Learn library: full-length lessons *(2026-06-21)*

Refreshed the 116-card evergreen library with the expanded, full-length lesson
bodies (`react/src/data/evergreenCards.json` — 106 of 116 cards rewritten longer;
~37k → ~173k chars of content; same ids/categories/visuals, none added/removed).
The consumer Learn tab renders the bundle, so the richer content goes live here.
The app DB (`content_items`, `format='card'`) is re-seeded to match via a one-shot
edge function that fetches the committed file and upserts by slug (service role) —
no SQL transcription.

## v9.5.10 — Sidebar: relocate sync status off the logo row *(2026-06-21)*

The wide "Synced · 1m ago" pill lived in the desktop sidebar header next to the
logo + wordmark + notification bell, overflowing the 240px rail and crowding/
clipping the Vyact logo. It was also **desktop-only** (`hidden lg:flex`), so mobile
never showed sync status at all.

Fix: moved `SyncStatusBadge` out of the header and **beside the cloud icon in the
ProfileSwitcher "Cloud sync" row**, which renders in the sidebar drawer on **both
desktop and mobile**. The header now carries just the logo, wordmark and bell (no
overflow); sync status — and tap-to-refresh — is reachable on every viewport.

## v9.5.9 — Production sync-health indicator + tighter transaction rows *(2026-06-21)*

**Production fault indicator** — finishes the deferred Phase 3 bullet of
`docs/budget-sync-fix-plan.md`. New `SyncHealthIndicator` claims the `lib/faults`
transport and surfaces any `unexpected` fault / dropped write as a quiet,
dismissible banner with a **Refresh** action (runs `manualRefresh`). A silent
data-loss is now user-visible in production, not just in the dev-only `FaultsPanel`.

**Tighter transaction rows** — removed the dead right-hand gutter on every
transaction row. The edit affordance kept its 32px layout width even at
`opacity-0`, leaving a permanent empty column; it now overlays the right edge on
hover (solid chip), so idle rows use the full width. Fixes it in **both** the
Transactions list and the Dashboard recent-transactions panel (shared `TxnRow`).

## v9.5.8 — Durable budget-allocation cross-device sync *(2026-06-21)*

Implements `docs/budget-sync-fix-plan.md`. Fixes "category allocations created on
one device never appear on another." Root cause was a **write-path asymmetry**: the
parent budget was written online-synchronously (`createBudgetChecked`), but each
child allocation went through the **fire-and-forget optimistic queue** and could
silently dead-letter into `vt_sync_failed` — never reaching the cloud, so realtime
had nothing to broadcast and a fresh login/private window showed no allocations.

**Phase 1 — atomic parent + children write (primary fix).**
- DB: new RPC `upsert_budget_with_allocations(h, b, allocs, p_mode)` writes the
  budget (reusing `upsert_budget`'s identity/dedup + owner/admin guard +
  `BUDGET_EXISTS`) **and** its full allocation set (scoped tombstone-then-insert) in
  **one transaction**. Validated on prod via a rolled-back `DO` block (create → 2
  live; replace → 1 live + 2 tombstoned, same budget; member → `42501`); advisors clean.
- Adapters: `upsertBudgetWithAllocations` on the `DataAdapter` interface,
  `supabaseAdapter` (RPC; maps `BUDGET_EXISTS → BudgetExistsError`), `hybridAdapter`
  (online-synchronous like `createBudgetChecked`, with a scoped cache seed), and the
  local `LocalStorageAdapter` (offline equivalent).
- Store/UI: new `saveBudgetWithAllocations` action; `BudgetFormModal` now saves via
  the single awaited atomic call instead of `upsertBudget` + a queued per-row
  `setBudgetAllocations`. Durability no longer depends on a background flush.

**Phase 2 — either-device realtime.** Already in place: owner/admin RLS on
`budget_allocations` shipped v9.5.0, and `realtime.ts` already subscribes both
tables — once Phase 1 guarantees children reach the cloud, they broadcast. (Concurrent
edits: row-level last-writer-wins, documented.)

**Phase 3 — close landmines.** Scoped the `supabaseAdapter.replaceAll('budgetAllocations')`
soft-delete to the **target budget** (it was `.eq('household_id')` — deleting *every*
budget's allocations in the household, a latent data-loss footgun). The `dataSlice`
allocation-read `.catch` now **records a fault and keeps the current allocations**
instead of silently swallowing a read failure into `[]` (which looked like loss).

Verified: tsc · eslint 0 errors · **161 tests** (money-model suites unchanged) · build.

## v9.5.7 — Fix: Learn microsite functions weren't deploying *(2026-06-21)*

Post-deploy verification of v9.5.5/v9.5.6 found `/learn`, `/learn/<slug>`,
`/sitemap.xml` and `/robots.txt` all returning the SPA shell instead of the
server-rendered pages — so social scrapers/crawlers never saw the OG meta or
JSON-LD. Root cause: Vercel's **project Root Directory is `react/`**, so the
repo-root `/api` functions and root `vercel.json` rewrites were ignored.

Fix: moved the functions to **`react/api/`** (converted to ESM `export default`,
since `react/package.json` is `type: module`) and added the rewrites to
**`react/vercel.json`** (excluding `/api` from the SPA catch-all). Reverted the
ignored root `vercel.json` rewrites. Verified the relocated ESM functions render
the per-card page (OG PNG + Article/LearningResource JSON-LD) against prod data.

Also fixed two **pre-existing** lint-gate errors surfaced by a full `eslint .`
during verification (the earlier gates were targeted): a non-breaking space in
`Transactions.tsx` and a conditional React hook in `AddFab.tsx` (moved the
`/auth/` early-return below the hooks — behaviour unchanged). Lint gate: 0 errors.

## v9.5.6 — Raster OG image for social shares *(2026-06-21)*

Replaced the placeholder SVG share image with a real **1200×630 PNG**
(`react/public/og-vyact.png`, branded Vyact social card). Repointed every
`og:image` / `twitter:image` and JSON-LD publisher logo — `index.html`, the
per-card pages in `api/learn.js`, and the in-app reader's JSON-LD — to the PNG, so
**Facebook / X / WhatsApp** (which don't render SVG) now show a proper branded
preview on every shared lesson. Closes the v9.5.5 follow-up note.

## v9.5.5 — Insights: combined Learn, shareable shorts, public SEO microsite *(2026-06-21)*

Five Insights upgrades focused on stickiness + discoverability.

**Learn + What's New combined.** The hub is now 3 tabs (For You / Learn / Plan).
Learn carries a **Lessons / Updates** segment — Lessons = the evergreen library,
Updates = the former What's New (editorial/curated). One place to browse.

**Learn shorts.** A **Shorts** launcher opens the evergreen library as a finite,
full-screen vertical scroll-snap **reel** (`EvergreenReel`) — one lesson per panel
with Save + Share, tap to read the full lesson. Mirrors the For You reel.

**Socially shareable shorts.** Every short (For You + Learn) has a **Share** action
(`lib/share.ts`): native share sheet with copy-link fallback. **Privacy line:**
evergreen lessons share a real public URL; a *personal* For You insight never gets a
public page — it shares an app-promo link with **no personal numbers**.

**Public, branded share previews + SEO/AI microsite.** Because the app is a pure
SPA (scrapers/AI crawlers don't run its JS), the shareable + indexable surface is
**server-rendered** via new Vercel functions:
- `/learn` — the library index (SEO hub, `ItemList` JSON-LD).
- `/learn/<slug>` — each lesson with full OG/Twitter meta, a branded preview image
  (`/og-vyact.svg`, Vyact logo + wordmark — promotes the app on every share), and
  **`Article` + `LearningResource` + `BreadcrumbList` JSON-LD** for rich-result +
  AI-citation eligibility on finance keywords/longtail.
- `/sitemap.xml` + `/robots.txt` advertise the 116 lessons to search engines.
- The SPA's default OG image + an `Organization` JSON-LD were added to `index.html`.
Content is public educational material (no user data); the functions read published
`format='card'` rows via the public anon key.

> Note: the branded OG image ships as SVG (no raster tooling/dep in this env).
> Slack/Discord/LinkedIn/Telegram render it; drop in a 1200×630 PNG later for full
> Facebook/X raster previews.

## v9.5.4 — Insights Hub §A: evergreen cards in the DB *(2026-06-20)*

Backend half of the Insights Hub (spec `docs/insights-integration-spec.md` §A).

**Migration `insights_hub_content_items_additive`** (applied to prod): additive,
forward-only columns on `content_items` for the new `format` model — `format`
(default `'article'`), `category`, `visual_kind`, `visual_ref` (jsonb), `body_md`,
`tags`, `reading_seconds`, `tone`, `india_relevant`, and external-link fields
(`source_name`, `source_url`, `why_it_matters`). Closed-set CHECK constraints
(format/visual_kind/tone domains, card-has-visual, external-has-source, source
allowlist) added `NOT VALID` then validated; `(format, published_at desc)` + GIN
`tags` indexes. Existing editorial articles are **untouched** (all default to
`format='article'`; the conditional checks don't bind them).

**Seeded the 116 evergreen cards** into `content_items` as `format='card'`
(`supabase/migrations/20260620120100_insights_hub_seed_cards.sql`, idempotent on
slug). Integrity verified exactly against the source library (count 116; body/title
char-sums and tag totals match; 65 icon · 11 stat · 40 diagram; 9 categories).

**Consumer:** `listPublishedContent()` (the What's New tab) now filters to
`format in ('article','external')` so the seeded cards surface only in **Learn**,
never as What's New articles. (Learn still renders from the bundled library; a
later step can switch it to read the DB rows.)

The admin card-authoring + visual picker + external curation UI is the next
follow-up (spec §C).

## v9.5.3 — Insights Hub (consumer v1) + the v9.5.2 dashboard fixes *(2026-06-20)*

Consolidated release. Turns **Insights** from a single content page into the app's
stickiness hub (consumer side of `docs/insights-hub-spec.md`), and carries the
v9.5.2 dashboard clarity fixes (below).

**Insights is now a 4-tab hub** (`pages/Insights.tsx`):
- **For You** — a personal-insight feed generated on-device from existing
  aggregates only (`lib/insightsFeed.ts`: savings rate, biggest category, a
  category down vs its 3-month average, a month-end spend forecast, Pulse, and
  contextual "learn this" nudges). **No new financial math**; deterministic;
  tone-mixed (≤1 constructive card per session, per the spec). Presented as a
  **full-screen reel on mobile** (`ForYouReel`): one insight per panel, vertical
  scroll-snap, a progress rail, an always-present **Cancel (✕)**, and a finite end
  panel (anti-doomscroll — no infinite feed).
- **Learn** — the 100+ **evergreen card library**, bundled as a static asset
  (`src/data/evergreenCards.json`, 116 cards) and rendered with **code-drawn
  visuals** (`CardVisual`: themed Lucide icon · big-number stat · SVG
  stack/bar2/arc/arrow/compare2). Searchable, category-filtered, favoritable
  (favorites persist locally for v1).
- **What's New** — the existing v6.3 editorial content module, re-homed as a tab.
- **Plan** — the **Planner absorbed** into Insights. The Planner FloatingTool
  bubble is **removed**; its Sparkles icon is adopted by **Ask Vyact** (was the
  chat bubble icon), per spec §8.

**Deferred to an admin/DB follow-up** (out of scope for a direct consumer deploy):
the additive `content_items` card columns + admin card-authoring, the external
"What's New" source-allowlist curation UI (RBI/SEBI/…), DB-backed evergreen
favorites, and per-week tone-cap persistence. The consumer hub runs fully without
them today; the library ships bundled rather than via DB.

### v9.5.2 (folded in) — Dashboard clarity

Two consumer-feedback usability fixes on the Dashboard (no money-model/schema change).

**Removed the "Total Balance" tile.** It showed all-time income − expenses, which
maps to neither account cash nor net worth — yet it linked to Net Worth, so its
label, math, and destination all disagreed and consumers couldn't place it. The
hero row already carries **Net Worth (today)** and **Cash Flow (this month)**, so
the lifetime figure was redundant. The supporting KPI block is now a clean 3-up row
of this-month flow metrics (Income / Expenses / Savings Rate). Removed the now-dead
`selectTotalBalance` subscription from the page.

**Insights now explain themselves and point to an action.** Each insight chip
previously stated only a fact ("DTI 20% — healthy", "Net worth building") with no
definition and (mostly) no link. Every insight now carries an **inline sub-line**
that (a) defines the term in plain language — savings rate, DTI = monthly debt
payments ÷ income, net worth = assets − debts — and (b) names the next action, and
the chip **links to the relevant page** (budgets / debts / reports / transactions).
`Insight` gained optional `detail` + `to` fields; rendering moved to a 2-up grid of
tappable cards with a CTA arrow.

A cluster of consumer-feedback-driven UX fixes (no money-model or schema change).

**Transactions — grouped by month + paginated.** The list previously rendered as
one flat (virtualized) stream, which grew unwieldy as history accumulated. It is
now **grouped into month+year accordions** and **paginated**: the most recent
`MONTHS_PER_PAGE` (3) months render by default, with a **"Load previous 3 months"**
control paging back through history until the earliest transaction. Each month
header shows its transaction count and net (income − expense) and is collapsible
(sticky while its rows scroll). All existing filters (search, type, category,
member, calendar day, §8 deep-link context) feed the same grouping; changing a
filter resets paging to the newest page. Replaces the `@tanstack/react-virtual`
flat virtualizer on this page — paging bounds the rendered DOM instead.

**Dashboard — removed the redundant "Net Worth Snapshot" panel.** It duplicated the
**"Net Worth · today"** hero card at the top (which already shows Net Worth with its
Assets/Debts split). Debt Overview now occupies that row on its own.

**Currency formatting — decimals only when meaningful.** `fmt()` now omits the
trailing `.00` for whole amounts (e.g. `₹16,000` not `₹16,000.00`), showing the
fractional part only when the value actually has one. This fixes the Debts summary
**"Min. Monthly"** tile overflowing its container, and de-clutters money across the
app. (`fmtShort` was already decimal-light.)

**Budget recommendations — rounded.** The recurring-forecast breakdown in the Budget
form ("… already committed via recurring this period" + per-category chips) now
displays whole-unit estimates (`₹72,857` not `₹72,857.14`); paise on an estimate is
noise. "Use as allocations" already applied the rounded figures.

**Reports — "Net by Period" → "Saved vs Overspent".** The old net-bar chart didn't
explain itself (its tooltip read "Net: ₹0.00" on flat periods). Reframed with a
clarifying title/subtitle, a Saved/Overspent legend, a zero baseline reference line
so surplus-vs-shortfall is legible at a glance, and a plain-language tooltip
("Saved ₹X" / "Overspent ₹X" with the in/out split, "No activity" when flat).

## v9.5.0 — Budgets owner/admin-managed + near-real-time sync *(2026-06-18)*

Budget management is now restricted to the household **owner or admin**; every
other member sees budgets **read-only**. This collapses the multi-writer surface
that had repeatedly produced cross-device/account sync gaps, and pairs it with a
**near-real-time** budget socket so the (now fewer) writers see each other's
changes without waiting for a refresh.

**Authorization (DB-enforced, defence in depth).** Migration
`v950_budgets_owner_admin_only_plus_realtime`:
- `upsert_budget(h,b,mode)` RPC now raises `42501` ("Only the household owner or
  admin can manage budgets") for any non-owner/admin, right after the membership
  check — the single writer for every entry point is guarded.
- `budgets` + `budget_allocations` insert/update/delete RLS policies tightened to
  `role_in(household_id) = any(array['owner','admin'])`.
- Dropped the permissive `balloc_household` `ALL` policy that previously OR'd with
  the per-command policies and silently granted any member allocation writes.
- Client mirrors it: `manage_budgets` removed from the `member` permission set;
  `Budgets.tsx` hides Add/Edit/Delete and shows a "View only" affordance for
  non-managers; store CRUD (`upsertBudget`/`removeBudget`/`setBudgetAllocations`)
  asserts `can(role,'manage_budgets')` for a clear message instead of a raw RLS
  reject.

**Near-real-time (accelerator on the refresh model).** New `lib/realtime.ts`
`subscribeBudgets(householdId)` opens a household-scoped Supabase Realtime channel
on `budgets` + `budget_allocations`; a row change fires a debounced **budgets-only**
refetch (`refetchBudgets`). `budgets` + `budget_allocations` were added to the
`supabase_realtime` publication. This **layers on** the R3 refresh triggers — if
the socket drops or never connects, budgets still converge on the next
visibility/focus/online/poll, so there is no regression, only acceleration.
Soft-deletes (UPDATE setting `deleted_at`) are handled free by the refetch filter.

Verified: tsc · ESLint · **161 tests** incl. money-model invariants · build; plus
an auto-rollback RPC role-guard test (owner create PASS · admin replace PASS ·
member rejected 42501 PASS) against prod, zero residue. The atomic
budget+allocations RPC is **deferred to a follow-up** (documented in the migration).

## v9.4.3 — Store god-module eliminated: data core + index.ts *(2026-06-17)*

Completes the structural half of TD-25 (behaviour-neutral; no consumer change),
landing on top of v9.4.2's feature work. The former 1,167-line `store.ts` is gone:
it was `git mv`'d to `store/slices/dataSlice.ts` (entity state + `init`/`refresh`
+ all CRUD + the money/EMI paths, moved **verbatim**), and a new **33-line
`store/index.ts`** is now the pure composition root — `create<Store>` folding the
seven domain slices (`modal`/`reconcile`/`notify`/`recurring`/`cloudAuth`/`sync`/
`data`) + the `Store` type + the E2E shim. `useStore`'s public type/behaviour is
byte-identical; the ~41 `import { useStore } from '../store'` consumers resolve to
`store/index.ts` unchanged (git tracked it as a 93%-similar rename).

Verified byte-identical: tsc · ESLint · **161 tests incl. money-model invariants
+ golden regression** · build — all green. Also dropped a pre-existing dead
`splitEmiPortions` import.

**Residual (TD-25):** `dataSlice.ts` is 723 lines (the cohesive data core) —
splitting its entity CRUD into a `crudSlice` to approach the ~300-line target is
optional polish. **TD-24** read/noop catch sweep + an in-app diagnostics view
also remain (the silent-write-loss paths already shipped in v9.4.0).

## v9.4.2 — Customer feedback round *(2026-06-17)*

Five usability improvements driven by customer feedback:

**Feedback 1 — EMI toggle relabelling** (`Debts.tsx`)
Renamed the EMI detail toggle from "EMI" / "Less" to "EMI Details" / "Hide Details"
for clarity.

**Feedback 2 — Unified debt payment path** (`Debts.tsx`, `TransactionFormModal.tsx`,
`store.ts`, `types.ts`)
Removed the inline payment form on the Debts page. "Record Payment" now launches
the TransactionFormModal pre-seeded with `loan_emi` category, debt reference, and
minimum payment amount. The store's `loan_emi` path now uses `applyPayment()` for
full re-amortisation (tenure / EMI / advance) with paymentLog. Part-payment strategy
picker appears in the form when amount exceeds the debt's minimum payment.

**Feedback 3 — Investment account → Net Worth** (`store.ts`,
`AccountFormModal.tsx`, `TransactionFormModal.tsx`)
Creating an Investment account now auto-creates a backing Asset on the Net Worth page
(type `investment`, liquidity `short`). The account's `assetId` FK links it to the
balance sheet. AccountFormModal shows a contextual hint; TransactionFormModal replaces
the passive text with an actionable "Create Investment Account" button.

**Feedback 5 — Category rows → filtered transactions** (`DonutCharts.tsx`,
`Dashboard.tsx`)
Each category row in the Spending by Category donut chart now links to
`/transactions?type=expense&cat=<catId>&month=<monthKey>` for drill-down. The outer
panel `<Link to="/reports">` was replaced with a "View All →" action button.

**Feedback 6 — Savings rate clarification** (`Dashboard.tsx`, `Reports.tsx`)
Dashboard savings rate card now redirects to `/reports?from=savings` and shows
subtitle "of income not spent". Reports page renders a dismissible contextual banner
with savings rate %, amounts, and the formula when navigated from savings.

**Verification:** `tsc --noEmit` clean, zero errors.

## v9.4.1 — Store slice-composition: cloudAuth + sync *(2026-06-15)*

Continues the TD-25 store decomposition (behaviour-neutral; no consumer change).
Two more domain slices extracted **verbatim** from `store.ts`, folded into `Store`
via `extends` so `useStore`'s public type/behaviour is byte-identical:
- `store/slices/cloudAuthSlice.ts` — `cloudEnabled`/`session`/`sessionLoaded`/`myRole`
  + `setSession` (sign-in/out transitions) + `refreshHouseholds` (role from memberships).
- `store/slices/syncSlice.ts` — `theme`/`loading`/`toasts`/`lastSyncedAt` + `manualRefresh`,
  `subscribeRealtime` (R3 refresh triggers), `setTheme`, `toast`, `dismissToast`.

`store.ts` 861 → 718 (now zero lint warnings — also cleared the long-standing
pre-existing `getMoneyMapMode` dead import). Housekeeping: git remote re-pointed to
`Authen27/Vyact.git`. tsc · ESLint · 161 tests (incl. money-model invariants +
golden regression) · build — all green.

**Still open (TD-25):** the data core (`init`/`refresh`/all CRUD, ~620 lines) split
+ the `store.ts → store/index.ts` rename — the money/refresh path, deliberately
sequenced as a dedicated careful pass. **TD-24** read/noop catch sweep + an in-app
diagnostics view also remain.

## v9.4.0 — Maintainability & observability release *(2026-06-15)*

A behaviour-neutral hardening release that resolves the partner-review
maintainability cluster (TECH_DEBT.md TD-23…TD-28). **No consumer behaviour
change** — every item is internal refactor, observability, type-safety, docs, or
CI. Verified throughout: tsc · ESLint · 161 unit tests (incl. the money-model
invariant + golden-regression suites) · production build. SemVer minor for the
size of the internal change surface, not because user-facing behaviour moved.

**Reliability / observability**
- **Fault taxonomy (TD-24).** New `lib/faults.ts` splits the app's offline-first
  `catch {}` blocks into `expected()` (degraded path — quiet, ring-buffered) vs
  `unexpected()`/`droppedWrite()` (contract violation / dropped write — one
  structured record + pluggable transport, non-throwing). Instrumented the
  silent-**write**-loss paths first: the sync queue's non-UUID drop, retry-
  exhaustion, and queue-persist failures, plus the `kvStore` last-ditch persist
  failure. This is the class of bug behind the v9.3.x budget dead-letters, now
  observable. (Partial: the read/noop sweep + an in-app diagnostics view remain.)

**Maintainability**
- **Sync queue extracted (TD-26, closed).** The queue mechanics moved out of
  `hybridAdapter.ts` (508→400) into `lib/sync/` — `backoff.ts`, `syncQueue.ts`
  (persistence + uuid-PK guard), `deadLetter.ts` (conflict/failed buckets + R5
  retry), and a pure `conflict.ts` (`classifyFlushError`). Byte-identical;
  storage keys unchanged. `hybridAdapter` keeps the cache-first read/no-clobber
  policy + a thin flush orchestrator.
- **Store god-module → Zustand slices (TD-25, in progress).** Began the
  `store.ts` split (1,167→861) with `store/slices/` (`modalSlice`,
  `reconcileSlice`, `notifySlice`, `recurringSlice`), the shared `store/localJson.ts`
  helpers, and a typed `store/testHooks.ts`. `useStore`'s public API is
  byte-identical (slices folded in via `extends`). The coupled init/refresh/auth/
  data/sync core + the `store/index.ts` rename remain for a dedicated pass.

**Type-safety & docs**
- **Risk-bearing `as any` removed (TD-27, closed).** Typed the money path
  (`Reports.tsx` → `Transaction[]`) and the MFA/security path (`Settings.tsx` →
  `Factor` + enrol-response narrowing); `store.ts` now has zero `as any`.
- **Doc/version truth (TD-23, closed) + CI drift guard (TD-28).** README pinned
  the real version; new `scripts/version-drift-check.mjs` (wired into the gate)
  fails the build when README/VERSIONS/CHANGELOG drift from `package.json` —
  permanently preventing the stale-version recurrence.

**Tests.** +CON-UNIT-066…077 across budget mapping, the fault taxonomy, and the
sync modules (incl. a seeded poisoned-op queue-replay regression). Suite 153→161.

## v9.3.3 — Budget identity owned by the database (the real fix) *(2026-06-14)*

The definitive resolution of the budget multi-device saga. v9.3.1 made the budget
id deterministic on the **client** — clever, but wrong: it coupled the primary key
to the business identity and broke in two new ways. (a) Delete a month's budget
then recreate it → the create landed on the soft-deleted **same-id** row via
`ON CONFLICT (id)` and never cleared `deleted_at`, so the budget came back
**invisible**. (b) Budgets recovered server-side kept their original random ids,
so a fresh deterministic-id create **collided** on `uq_budget_month` and
dead-lettered. Meanwhile goals/debts/assets "just worked" precisely because they
mint a fresh random id per create and have no identity constraint — budgets were
uniquely fragile *because of the client-side identity hack*.

**Identity now lives in the database**, where it belongs, behind one writer that
every entry point uses (the form today; Ask Vyact / WhatsApp / 3rd-party API next):

- **DB** — new `upsert_budget(h, b, mode)` RPC
  ([migration](../supabase/migrations/20260614140000_v933_upsert_budget_identity_authority.sql)).
  `create` does `INSERT … ON CONFLICT (identity) WHERE deleted_at IS NULL DO NOTHING`;
  if nothing inserts, the slot is taken → raises `BUDGET_EXISTS` (race-proof, and
  it fires for **another member's not-yet-synced** budget too). `replace` does
  `DO UPDATE …, deleted_at = NULL` (idempotent set / revive — for machine callers).
  The DB assigns the id. Validated against the live function with an **auto-rollback
  scenario harness** (create, duplicate-reject, delete+recreate, replace-converge,
  replace-revive, annual) — all PASS, zero residue.
- **App** — **removed** the deterministic-id helper. New budgets go through
  `adapter.createBudgetChecked` (`store.upsertBudget` create branch) → the RPC; the
  Budgets form surfaces `BudgetExistsError` as "a budget for July 2026 already
  exists — refreshing to show it" and pulls fresh. Edits keep the concurrency-safe
  update-by-id path. **Note:** creating a budget now requires being **online** —
  it's the only honest way to check the whole household before creating (per the
  "second member" rule); offline create gets a clear message, not a silent loss.
- **Behavior** (product-confirmed): one budget per `(household, scope, period)`;
  delete+recreate **replaces**; a second member is **told it exists** rather than
  creating a duplicate.
- **Tests:** −CON-UNIT-065 (deterministic-id helper removed) · +CON-UNIT-067/068
  (RPC create routing + `BudgetExistsError` mapping). tsc · 152 tests · build green.

## v9.3.2 — Budget create reaches the cloud (NOT-NULL `period` fix) *(2026-06-14)*

Follow-up to v9.3.1. With deterministic ids in place, a **newly created** budget
(e.g. a July 2026 budget) still didn't appear on other devices — because the
create never reached the cloud at all.

**Root cause.** `budgets.period` is a legacy `NOT NULL DEFAULT 'monthly'` column.
The v9.1 budget form is *scope*-based and never sends `period`, but
`budgetToRow` mapped the missing value to an **explicit `null`**
(`period: b.period || null`). Every new-budget `INSERT` therefore sent
`period: null` → NOT NULL violation → the optimistic write threw, retried, and
**dead-lettered**: it showed locally (optimistic cache) on the creating device
but never persisted, so no other device could pull it. (v9.3.1's June budgets
"worked" only because they were recovered server-side — the create path itself
was never exercised post-fix.)

- **App** ([supabaseAdapter.ts](react/src/lib/supabaseAdapter.ts) `budgetToRow`):
  `period` now defaults to `'monthly'` instead of `null`, consistent with the
  `rowToBudget` read default. (Provenance columns were already safe — `provToRow`
  emits `undefined`, which is dropped from the payload so DB defaults apply.)
- **Tests:** +CON-UNIT-066 (a scope-only budget serializes `period:'monthly'`,
  never null). Suite 153 → 154 green; tsc + build clean.
- **Healing:** any budget already stuck in the creating device's dead-letter
  queue re-applies cleanly with this build — tap the sync badge → *Refresh &
  re-apply* (or just re-save the budget).

## v9.3.1 — Budget multi-device convergence (root-cause fix) *(2026-06-14)*

Budgets were not syncing across a household's devices: one device's budgets
vanished, another's never appeared, a third showed a budget matching neither.

**Root cause.** A budget's business identity is `(household, scope, year, month)`,
enforced in the DB by the partial unique indexes `uq_budget_month` /
`uq_budget_annual`. But the client minted a **random `uid()`** for every new
budget, so two devices creating the same period produced two different primary
keys for the *same* identity slot. The first `INSERT` won; the second violated
the unique index, was retried, and **dead-lettered** — silent cross-device loss.
(Prod evidence: the June container was removed by a single-row `removeBudget`,
while sibling-device creates for the same slot never persisted.)

- **App — deterministic budget identity** (`lib/budgetIdentity.ts`): a new
  container's id is now derived from its identity (same idempotency principle as
  `recurringInstanceId`), so every device computes the **same** id for a slot and
  the write `upsert`s one row (`ON CONFLICT (id)`) instead of colliding.
  `store.upsertBudget` assigns it for new month/annual containers;
  `BudgetFormModal` no longer mints `uid()` and uses the saved id for allocations.
- **DB** (migration `20260614130000_v931_budget_identity_convergence.sql`):
  - `replace_budgets` rewritten — it had **stripped** `scope/period_year/
    period_month/custom_name` on every restore (destroying v9.1 identity) and
    soft-deleted-then-plain-`INSERT`ed the same ids (PK collision on any real
    backup-restore). Now schema-correct + `ON CONFLICT (id) DO UPDATE` (true
    atomic replace).
  - Dropped the legacy `budgets_household_category_uniq` index — the second,
    competing identity model that coexisted with the v9.1 per-period indexes.
- **Tests:** +CON-UNIT-065 (deterministic identity: stable, UUIDv8, slot-distinct,
  annual-ignores-month). Suite 149 → 153 green; tsc + build clean.
- **Recovery:** the affected budgets are *soft-deleted, not lost* (allocations
  still sum to their container limit) and can be un-deleted surgically.

## v9.3.0 — WhatsApp Business integration: connection foundation *(2026-06-14)*

The first slice of the WhatsApp integration — establishing the Meta ↔ Vyact
connection and the per-user phone-link plug-in. Transaction-logging use-cases are
deferred to a later phase. Built to the corrected design in
`whatsapp-vyact-solutioning.md`; operational runbook in `whatsapp-connection-setup.md`.

- **DB** (migration `20260614120000_whatsapp_connection_foundation.sql`):
  `profiles.phone_number / phone_verified_at / whatsapp_household_id` (+ unique phone
  index), and two **RLS-locked, service-role-only** tables —
  `whatsapp_verification_otps` (hashed OTPs, attempt counter, TTL) and
  `whatsapp_inbound_messages` (webhook idempotency + audit).
- **Edge Functions** (`supabase/functions/`):
  - `whatsapp-webhook` — Meta's GET verify-token handshake (the connection
    validation) + constant-time HMAC signature check on POST + ack-first idempotent
    inbound logging. Message *processing* is a stub until the use-case phase.
  - `whatsapp-send-otp` / `whatsapp-verify-otp` — the authed phone-link handshake:
    household-membership check, 60s resend cooldown, 5-attempt lockout, constant-time
    compare, phone uniqueness. No secrets in code (all from Supabase secrets).
- **App:** Settings → **WhatsApp** panel (`components/settings/WhatsAppLink.tsx`) —
  send-code → verify → linked, cloud-only.
- **CI:** `deploy-edge-functions` job (best-effort, `needs: db-migrations`).

Validated: React tsc + 149 tests + build + dev-boot green; DB migration applied,
RLS on. The Edge Functions are **dormant** until deployed and the Meta credentials /
secrets / `phone_verification_otp` template / webhook are configured (see runbook).

## v9.2.0 — Sync hardening: refresh-based convergence (R1–R5) *(2026-06-13)*

Targeted fixes for the growing cross-account / cross-device / cross-browser sync gaps, built to the **refresh-based** product decision (devices converge on refresh, not a live socket). Full audit + plan in [`docs/SYNC_FIXPLAN.md`](../docs/SYNC_FIXPLAN.md).

- **R1 — a refresh now actually converges.** Two delta-sync defects fixed in `supabaseAdapter.ts`: (1) `listSince` used a strict `.gt('updated_at', cursor)` which **silently skipped any row tying the cursor's exact millisecond** → now `.gte(...)` (boundary rows re-upsert idempotently); (2) `remove()` / the `budget_allocations` soft-delete set only `deleted_at`, never bumping `updated_at` — so a delete's tombstone kept a stale timestamp, **never entered another device's `updated_at >= cursor` window, and the row lived on as a ghost** (the Net-Worth case-7 bug). Soft-deletes now bump `updated_at` in the same write. Pinned by `CON-UNIT-055/063`.
- **R2 — no duplicate recurring transactions across devices.** `generateTransaction` used a random id, so two devices materialising the same due occurrence each inserted a row. Instances now get a **deterministic UUIDv8 keyed on `(schedule, occurrence-date)`** (`recurringInstanceId`, cyrb128) so concurrent generation upserts the *same* row; `runRecurringEngine` also guards against an already-present occurrence. Pinned by `CON-UNIT-064`.
- **R3 — refresh triggers, dead realtime retired.** The old `postgres_changes` subscription was misconfigured (no `table`, one household filter for every table — it couldn't reliably deliver) and is removed. `subscribeRealtime` now pulls on `visibilitychange→visible`, `focus`, `online`, plus a 90 s foreground poll (debounced 400 ms). App-init + post-write refreshes unchanged.
- **R4 — honest sync status + manual refresh.** The `sync_failed` dead-letter (a write that exhausted retries) was **completely invisible** — a money write could vanish with no signal; the adapter now exposes `pendingFailedCount()` and the `SyncStatusBadge` is a **tap-to-refresh** button showing worst-of `{offline · N failed · N conflicts · syncing · synced "· 2m ago"}` driven by a new `lastSyncedAt`. The tap runs `manualRefresh()` — a full-sweep resync (clears delta cursors) that also catches any tombstone a delta window missed.
- **R5 — no silent lost writes.** Conflicts/failed ops can now be **re-applied**: `retryDeadLettered()` re-queues them (retries reset, `expectedUpdatedAt` stripped for conflicts), and `SyncConflictBanner` surfaces both buckets with **"Refresh & re-apply"** (pull latest, then retry) / "Dismiss".
- **R6 — atomic reconcile: deferred with a ready, column-verified RPC spec** (`docs/SYNC_FIXPLAN.md`). It self-heals on the next refresh under the refresh-based model, and a money-mutating SQL RPC shouldn't ship without a Supabase-branch test + invariant coverage — so it's specced, not rushed.

No money-model change (INV-1..9 untouched). tsc clean · **149/149 tests** (`+CON-UNIT-063/064`) · build ✓ · dev-boot 200.

## v9.1.2 — Budgets: monthly/annual only (remove custom) + Recurring build fix *(2026-06-13)*

1. **Removed the "custom" budget scope.** Custom date-range budgets were dropped
   from the Budgets module — they added confusion without a clear household use-case.
   Budgeting is now **monthly or annual only**.
   - `BudgetScope` is `'month' | 'annual'`; the `customName` field and the form's
     Custom scope button + name/date-range inputs are gone. Legacy `custom` rows
     opened for edit are coerced to `month`.
   - `resolveBudgetPeriod` simplified (no custom branch); adapter clears the legacy
     `custom_name` column on every save.
   - **DB:** validated CHECK constraint `ck_budget_scope` (`scope IN ('month','annual')`)
     so a stale client can't reintroduce custom — migration
     `supabase/migrations/20260613120000_budget_scope_drop_custom.sql` (0 custom rows existed).
2. **Fixed a build-breaking duplicate in `Recurring.tsx`.** A botched merge had
   duplicated the entire component body, leaving a dangling block that failed
   `tsc -b` (`TS1128` at EOF) and broke every production deploy. De-duplicated to
   the single current RRULE-based component — no behaviour change.

Validated: tsc clean · vitest 147/147 · production build · dev-boot HTTP 200.

## v9.1.01 — Cross-device consistency bugfixes *(2026-06-13)*

Patch release focused on parity issues reported between desktop and mobile for
Recurring and Dashboard surfaces. No schema change.

1. **Recurring list order is now deterministic across devices.**
   - The Recurring page now sorts schedules by `nextDueDate` ascending, then by
     `updated_at` descending, then by `id` as a final tie-breaker before render.
   - Cloud reads for `recurring` now apply explicit ordering
     (`next_due_date asc`, `updated_at desc`) in the Supabase adapter.
   - Result: both devices see the same schedule ordering instead of relying on
     non-deterministic fetch order.

2. **Dashboard month key now uses local calendar month.**
   - Added `localMonthKey()` and switched Dashboard monthly selectors/links to
     local month semantics.
   - Result: reduced cross-device Cash Flow mismatches around UTC date/month
     boundaries.

3. **Budget progress no longer false-empties on allocation fetch failures.**
   - `store.refresh()` now preserves the previous in-memory
     `budgetAllocations` snapshot when the allocations fetch fails, instead of
     replacing it with `[]`.
   - Result: desktop/mobile no longer diverge into "empty budget progress" due
     to transient allocation read errors.

> Validated: file diagnostics clean; project typecheck completed clean via direct
> `node .../typescript/bin/tsc --noEmit` invocation in this environment.

## v9.1.0 — Feedback batch: budgets redesign, recurring RRULE, deep-links, account-split removal *(2026-06-12)*

Built to [`vyact-v9-feedback-triage-and-solutions.md`](../vyact-v9-feedback-triage-and-solutions.md)
+ [`vyact-v9-developer-investigation-prompt.md`](../vyact-v9-developer-investigation-prompt.md).
Migration `supabase/migrations/20260612120000_v91_budgets_recurring_receivables_deeplink.sql`
(applied to prod; 4 legacy budgets → 2 month containers + 4 allocations).

**§4 Budget redesign + Investigation A fix (cross-device divergence).** Root cause:
`budgets` had no strict identity — only `category` + a fuzzy `period` — so two
devices keyed "the monthly budget" differently and minted parallel rows. Fix is the
data-model redesign: budgets now carry a **strict identity** (`scope` ∈
month/annual/custom + `period_year` + `period_month`) with **unique constraints**
(`uq_budget_month`, `uq_budget_annual`) — the same budget on every device. A budget
is a **period container**; per-category limits live in a new cloud-synced
`budget_allocations` **child table** (`budgetAllocations` adapter entity), not the
v8.8-dropped jsonb. New form: scope picker, explicit identity (June 2026 / 2025 /
"Maldives Trip"), per-category allocations with sum-check warnings, a read-only
**recurring forecast** line ("₹X already committed via recurring", money-model A8),
and a current-month create nudge. `budgetLines()` flattens container+allocations so
Pulse/planner/notifications keep working.

**§5 Recurring redesign.** Recurrence is now authored **only** in the Recurring
section (removed from the Transaction form — single source of truth). Added an RFC
5545 **RRULE** (`buildRRule`: daily/weekly/monthly/quarterly[=monthly-interval-3]/
yearly + COUNT/UNTIL, mutually exclusive), an **owner** member field (flows to
generated transactions' attribution), **investment** schedules (alongside
expense/income), and an **Ends** condition (never / after N / on date). The
meaningless **active/deactivate toggle is removed**. Materialised transactions link
back via `transactions.recurring_schedule_id` and carry the owner.
*(Noted gap: COUNT/UNTIL enforcement in the generation loop still rides the legacy
`computeNextDueDate` driver; the RRULE is stored + drives the form. Full
rrule-expansion in the generator is a follow-up.)*

**§6 Debt receivables + Investigation B.** Finding: the `DebtFormModal` direction
selector + counterparty field were **already present** in current code (the "stub"
feedback was stale); the DB has `direction`/`counterparty_name` (v7.2.0). Creating an
"Owed to me" receivable works and counts toward assets/net worth. Added the §8 debt
drill-down for receivables.

**§7 Account-split removal.** Removed the multi-account `AccountDrawer` from the
transaction form; adapter stops round-tripping `extras.accountSplits`; the migration
scrubs the key (0 rows affected; asserted clean). **People bill-splitting (SplitInfo)
is untouched.**

**§8 Unified transaction deep-link.** One query-param contract extends `?type`/`?cat`
with `?month`, `?from&to`, `?budgetId` (→ period + allocation categories), and
`?debtId` (→ payments/EMIs via `emi_split.debt_id`/`linkedDebtId`/`debt_id`). Wired:
budget click, budget-category click, debt "Payments" button, and the dashboard
month income/expense cards (now carry `&month`). A context chip reflects the active
deep-link; Clear-all resets.

**§3 Google SSO** shipped in the prior change (button un-stubbed).

> Validated: tsc clean · vitest 147/147 (incl. new `v91.test.ts` + money INV-1..9) ·
> production build · dev-server boot. The app can't be exercised in a live browser
> here — do a QA pass on the budget create/edit + allocations, the recurring form,
> and the three deep-links.

## v9.0.1 — UX improvements: debt count, auto-approve, pagination, voice-to-text *(2026-06-11)*

Five targeted UX improvements on top of v9.0.0. No schema change.

1. **Active debt count in Debts** — right-aligned count of active debts (balance > 0) displayed inside the filter tab row, matching the information-density pattern of other pages. (`Debts.tsx`)
2. **Auto-approve ON by default for Recurring** — new recurring schedules now default to `autoConfirm: true` so transactions are generated automatically. The checkbox label is updated to "Auto-approve transactions (uncheck to review manually)". Changed in `Recurring.tsx`, `store.ts`, `TransactionFormModal.tsx`, and `lib/recurring.ts`. Existing schedules with an explicit `false` are not affected.
3. **Household button position verified** — Create Household button was already correctly positioned in the top-right header, matching other pages. No code change needed.
4. **Paginated activity trail** — the Households activity log now paginates at 10 entries per page with Previous / Next controls and a "Page N of M" indicator, replacing the old "show first 25 → show all" toggle. Page resets to 1 on filter change. (`Households.tsx`)
5. **Voice-to-text overhaul** — Web Speech API implementation rewritten with `interimResults: true` and `continuous: true` for live transcript preview in the input placeholder; language auto-detected from `navigator.language`; error-specific toast messages (no-speech, audio-capture, not-allowed); up to 2 automatic retries on `no-speech`; tap-to-stop toggle on the mic button with a coral glow ring animation; final results append instead of overwrite. (`Chat.tsx`)

Typecheck clean (`tsc --noEmit` — zero errors). No theme change.

---

## v9.0.0 — Transaction forms & categories rebuild (txn-redesign) *(2026-06-11)*

A ground-up rebuild of how transactions move money, built to the binding
architect spec [`vyact-txn-redesign-architect-spec_1.md`](../vyact-txn-redesign-architect-spec_1.md).
Single big-bang release behind `FEATURES.txnRedesign`; the data migration is
forward-only (not flag-reversible). Governing money-model principles (A1–A9)
and the R-AGG-1..7 aggregation rules are now pinned by an invariant test suite.

**Locked decisions (spec §0):**
- **D1 — transfers are a single row.** `type='transfer'` with both `account_id`
  and `to_account_id` NOT NULL and `category` NULL. The old `__tg` paired-row
  encoding is retired. Investments follow the same shape (`type='investment'`).
- **D2 — reconciliation & investment-value updates are an account-level
  `reconciliation_offset`, NEVER a transaction.** The drift between the computed
  and the user-stated balance is absorbed into `accounts.reconciliation_offset`
  with a dated quiet-log entry (`reconciliation_log` jsonb). The offset feeds net
  worth / balances and is structurally invisible to every spend/income
  aggregator. Investment "Update value" reuses the exact same mechanism.
- **D3 — the v7.0.3 track picker is retired.**
- **D4 — big-bang single release** behind one feature flag.
- **D5 — Goals & Tax remain permanently absent.**

**Schema & migration (`supabase/migrations/20260608120000_v9_txn_redesign.sql`):**
- `accounts.kind` remapped to the strict enum `bank | cash | credit_card |
  investment | loan`; `reconciliation_offset numeric NOT NULL DEFAULT 0` and
  `reconciliation_log jsonb DEFAULT '[]'` added.
- `transactions.category` is now nullable; per-type FK matrix backfilled via
  `_v9_resolve_account()` (expense → `account_id`, income → `to_account_id`,
  transfer/investment → both). Legacy category ids renamed (food→food_dining,
  rent→rent_mortgage, debt_payment→loan_emi, etc.); goal_*/tax_* folded to
  `other_expense`; `balance_adjustment` rows folded into the offset.
- Constraints added **last** (after data cleaned): `CK_txn_type`,
  `CK_txn_category_by_type`, `CK_txn_accounts_by_type`, `CK_account_kind`.
- Backups (`_backup_v9_*`) taken before migration; INV-9 before/after
  reconciliation passed on prod data (spend/income identical, 0 constraint
  violations, 3 issues logged to `migration_issues`, never silently dropped).

**Categories (§3):** type-scoped enums — no flat pool. Transfers and investments
carry **no** category. `LEGACY_CATEGORY_ALIASES` keeps pre-migration local caches
rendering sane labels/colours for one session; `deterministicColor` now resolves
aliases too.

**Forms (§4):** investment direction toggle (Added/Withdrew), loan picker for
`loan_emi` (SYSTEM_SPLIT: interest = visible expense, principal = system transfer
leg into a `kind='loan'` account, reducing the debt — atomic), category field
hidden for transfer/investment.

**Aggregation (§6):** net worth folds over the linked `Asset`/`Debt` entities, so
the reconcile action now flows the stated value through to the linked entity
(R-AGG-5) — the offset reaches net worth without double-counting in spend/income.

**Invariant net (§7):** `lib/__tests__/moneyModel.invariants.test.ts` pins
INV-1 (transfer neutral), INV-2 (investment neutral), INV-3/3b (value-update is
an offset + quiet log, no transaction), INV-5 (exact EMI split), INV-6 (balance
fold), INV-7 (net worth = assets − liabilities), INV-9 (type-scoped categories).
Engine + regression + Ask Vyact suites updated to v9 semantics. 132 tests green;
tsc clean; production build clean; dev server boots and serves the app.

> The app can't be fully exercised here (no live browser) — validated via tsc +
> 132 unit tests + production build + dev-server boot. Do a browser QA pass on
> the new transaction/investment forms and the account reconcile flow.

## v8.9.1 — Budgets toolbar cleanup: remove Copy, Suggest icon-only *(2026-06-10)*

UI cleanup on the Budgets page toolbar.

- **Removed the "Copy" button** — the carry-forward action (`copyPrevious()`) and
  its `copyBudgets` import from `lib/budgetIntel` have been deleted. The function
  duplicated current budgets as an editable proposal, but was redundant with the
  Suggest flow.
- **"Suggest" button is now icon-only** — renders the Sparkles icon (15px) with a
  `title="Suggest budgets"` tooltip for accessibility. Text label removed to
  declutter the header.

No schema change; no data-layer change. Pure presentation cleanup.

## v8.9.0 — Recurring schedules: household + user scoped (cloud-synced) *(2026-06-07)*

Userback **#7830371** — recurring schedules were browser-local (`localStorage`),
so they didn't follow the household across devices and weren't attributed to a
user. They're now a **first-class, cloud-synced, household-scoped entity** with
RLS and `created_by` attribution.

- **DB:** new `recurring_schedules` table (migration
  [`20260607160000`](../supabase/migrations/20260607160000_v89_recurring_schedules.sql))
  — household-scoped RLS (read = member; insert/update/delete = owner/admin/member),
  `created_by default auth.uid()`, `updated_at` trigger, delta-sync index. Mirrors
  the accounts-table shape.
- **Adapter:** added `'recurring'` to the `Entity` union with `RecurringRow` +
  `recurringToRow`/`rowToRecurring` mappers, `list`/`upsert`/`mapRowBack`/`tableName`
  branches; `HybridAdapter` syncs it like every other entity (cache + queue +
  delta-sync + force-resync). `RecurringSchedule` gains `createdBy` + `updated_at`.
- **Store:** `refresh()` loads recurring via the adapter; `upsertRecurring` /
  `removeRecurring` / `runRecurringEngine` persist through the adapter (was
  `localStorage`-only) with optimistic-concurrency on edits. The v7.3 backfill now
  upserts recovered schedules to the cloud too.
- **Migration of existing data:** a one-shot `init()` step moves any pre-cloud
  `localStorage` `recurring` list into the household entity, then retires the
  legacy key. Local-only mode keeps working via the `LocalStorageAdapter`.

Typecheck 0 errors; suite 123/124 (pre-existing unrelated CON-UNIT-024); build
clean. Live table verified (16 cols, 4 RLS policies). This clears the last
deferred money-model item.

## v8.8.1 — Phase 5: freeze the Money-Model flags (code cleanup, no behaviour change) *(2026-06-07)*

The v8.8.0 features were proven and are now permanent: the toggles were **removed**
and the always-on behaviour inlined. No user-visible change.

- **Removed** the `moneyModel`, `budgetsV2`, and `entryV2` flag objects from
  [`config/features.ts`](src/config/features.ts). The account model (B1.1
  cash-default enforcement, balances, reconcile, ledger), Budgets v2 (deterministic
  colour — the colour picker is gone for good, history, Suggest/Copy, monthly/annual
  hierarchy) and Entry v2 (no auto-focus, "More details" short form) are now
  unconditional.
- The only surviving preference is **`FEATURES.savedViews.show`** (default `false`
  — Saved Views stay hidden, table/RPC dormant). `FEATURES` now holds just
  `onboarding`, `askVyact`, and `savedViews`.
- Inlined the checks in `store.ts`, `Accounts.tsx`, `Budgets.tsx`,
  `BudgetFormModal.tsx`, `TransactionFormModal.tsx`, `SavedViewsBar.tsx`; dropped
  the now-unused `FEATURES` imports and stale flag comments.
- Typecheck 0 errors; suite 123/124 (pre-existing unrelated CON-UNIT-024); build clean.

This completes the Money-Model execution program (all phases 1–5). Goals & Tax
remain removed; recurring household/user sync is the next deferred item.

## v8.8.0 — Money-Model v2: goals/tax removed, two-number dashboard, Ask Vyact v2 + alpha-feedback fixes *(2026-06-07)*

A large functional release consolidating four build phases from the Money-Model
execution plan plus the round of Userback alpha feedback. Net effect: the money
model is the spine, **Goals & Tax are gone as modules**, the dashboard leads with
**two honest numbers**, budgets are a **period→category hierarchy**, and Ask Vyact
answers more questions in a more human way. (Versioning was held across the phases
and is consolidated here.)

### Alpha-feedback fixes (Userback)
- **Onboarding no longer seeds ₹0 budgets** (#7830377) — it stopped creating
  zero-limit budget cards (and the debt goal); real budgets come from the Budgets
  "Suggest"/"Copy" flow with actual amounts.
- **Light-mode checkbox/input theming** (#7830379) — added a themed `accent-color`
  so checkboxes read as clearly empty when unchecked (not "default-selected").
- **Removed "stub mode / Beta / v8-wires-Claude / v7.0 LLM" copy** (#7830363) from
  Chat + Planner — the deterministic engine is the product, not a stub.
- **Ask Vyact chips no longer fall back** (#7830389) — "Which budgets are at
  risk?", "upcoming bills", "my debts/payoff" now classify to real answers
  (`interpret.budgets` / `interpret.bills` / `interpret.debts`) instead of a
  clarifier; broadened `interpret.lookup`.

### Goals & Tax removed as modules (e)
- Pulse Score dropped Goal Progress → **4 components** (Budgets/Savings/Trend/Debt),
  renormalised. Deleted the Goals route/page/modals, nav item, dashboard panel,
  Add-FAB "Add goal" + `g` shortcut, Ask Vyact goal chips + `forecast.goal`,
  `goalsLens`/`taxNudge` engines, and the tax-nudge card. Planner's dead `/goals`
  links repointed to Net Worth. (`Goal` type/store kept dormant to avoid
  destabilising seed/migration/backup.)

### Dashboard & Pulse (a + #7)
- New **two-number hero**: **Cash Flow** (flow — money in vs out this month) and
  **Net Worth** (stock — assets − liabilities), with distinct visual treatment so
  they never blur (A7). The Pulse gauge now always shows **one actionable next
  step** pointing at the weakest applicable component (#7830375).

### Categories & Budgets (b + c)
- **B1.5 scoped categories — data-layer enforced**: `upsertTransaction` forces
  `category: 'transfer'` on any transfer regardless of input path, so a transfer
  can never carry a spend/earn category or double-count (R1). Inert flag removed.
- **Budgets are a monthly/annual → category hierarchy (c)**: removed the v8.7.0
  sub-category allocations (type/field/editor/`rollupAllocations`/flag/DB column,
  migration [`20260607150000`](../supabase/migrations/20260607150000_v8_drop_budget_allocations.sql))
  and replaced them with a **Monthly / Annual budget header** whose children are
  the existing category budgets (`budgetRollup`, period-normalised).

### Budgets intelligence, Reports, Planner, Ask Vyact (d, g, #8, #4, #6)
- **Suggested budgets are editable before saving** + a **Copy** (carry-forward)
  action (d).
- **Reports By-member / By-account breakouts are permanent** (g, R6) — fold over
  `reportableTxns` (transfers/adjustments excluded).
- **Planner advice adapts to household type** (#8) — business households get tax-
  reserve + cash-runway guidance (`PlannerContext.householdType`).
- **Ask Vyact**: word-by-word **typing-stream** replies after a brief pause (#4),
  and **voice input** via the Web Speech API where supported (#6).

### Tests / provenance
- R7 provenance-lifecycle test (estimated → confirmed). Pulse/golden/forecast
  suites updated for the 4-component Pulse and goal-forecast removal.

### Status
- Typecheck 0 errors; suite 123/124 (the one failure is the long-standing,
  unrelated `calculations` debt-component assertion, CON-UNIT-024); production
  build clean. **Deferred:** recurring household/user sync (#7830371 — dedicated
  pass). **Parked:** B4.5 re-theme. **Next (Phase 5):** make the surviving
  `moneyModel.*` / `budgetsV2` / `entryV2` flags permanent (remove the toggles).

## v8.7.1 — Enable Money-Model Epic 1, Budgets V2, Entry V2 (config only) *(2026-06-07)*

Configuration-only patch — flips the previously-built features ON in
[`src/config/features.ts`](src/config/features.ts). No code change; flag flips only
(hence a patch bump, not a minor).

**Turned ON:**
- `moneyModel.enabled` + `enforceAccount` (B1.1), `openingBalance` (B1.2),
  `reconciliation` (B1.3), `ledger` (B1.4), `scopedCategories` (B1.5) — Epic 1
  account model now live (account-on-every-txn defaulting to Cash; account
  balances, Fix-balance reconciliation, and per-account ledger on the Accounts page).
- `budgetsV2.enabled` + `history` (B2.2), `allocations` (B2.3), `suggest` (B2.4)
  — budget timeline, sub-limit editor, and suggested budgets now live (B2.1 was
  already on).
- `entryV2.enabled` + `shortForm` (B4.2/B4.3) — transaction form "+ More details"
  disclosure now live (B4.1 already on).

**Left OFF (unchanged):** `goals.enabled`, `goalsLens`, `taxNudge`,
`entryV2.showSavedViews`.

Typecheck + production build clean; suite 126/127 (the one failure is the
pre-existing unrelated `calculations` assertion). The B1.6 backfill (v8.4.0) is
already applied to prod, so the account model has compliant data to read.

> ⚠ **QA note:** these surfaces were previously verified via typecheck/build/dev-
> transform + unit tests only. This release makes them user-visible — do a browser
> click-through (especially the transaction add/edit flow under `enforceAccount` +
> `shortForm`, and the Accounts ledger/reconcile) to confirm runtime behaviour.

## v8.7.0 — Money-Model: budget allocations (B2.3) + form reshape (B4.2/B4.3) *(2026-06-07)*

Closes the previously-deferred money-model items.

### B2.3 — Budget category allocations (`budgetsV2.allocations`)
- **Schema:** `Budget.allocations?: BudgetAllocation[]` + additive `budgets.allocations`
  jsonb column (migration [`20260607140000`](../supabase/migrations/20260607140000_v8_budgets_allocations.sql),
  applied + verified) mapped through the adapter. Existing budgets default `[]`.
- **UI:** `BudgetFormModal` gains a sub-limit editor (add/remove `{category, limit}`
  rows) with a transparent **allocated / unallocated** indicator and an
  **over-allocation warning** via the tested `rollupAllocations()` engine (A1).
- *Deferred:* per-allocation actual-spend bars need allocation↔transaction
  category matching (allocations are free-text labels) — a clean follow-up.

### B4.2/B4.3 — Transaction form reshape (`entryV2.shortForm`)
- Secondary fields (**Time**, **Recurring**, **Note**) collapse behind a
  **"+ More details"** disclosure; Time defaults to now (B4.3 — no Material clock
  dial added). Primary fields (amount, category, account, description) stay
  visible; required-field validation is unaffected. Resets collapsed on each open.
  Flag OFF → the full form exactly as before.

### Goal real-account backing — explicitly deferred
- Goals were removed in v8.6.0 (`FEATURES.goals.enabled = false`); building
  real-account-backing UI for a disabled feature would be contradictory. The
  `goalsLens` engine already supports it via a `GoalLensMeta` intersection (no
  `Goal` schema change needed), so it's a clean increment for when goals return.

### Validation
- Typecheck 0 errors; suite 126/127 (pre-existing unrelated `calculations`
  assertion); production build clean; **dev server booted (local-only)** and all
  edited modules transform cleanly through Vite. All new behaviour OFF by default.
  With this, **every actionable item in the money-model spec is built** (B4.5
  re-theme remains PARKED per spec; goal-backing parked behind the goals removal).

## v8.6.0 — Remove the Goal concept + its Pulse association (reversible) *(2026-06-07)*

Removes goals from the product **for now**, behind a single master switch
`FEATURES.goals.enabled = false` (flip to restore — no data deleted, models intact).

- **Pulse Score** — Goal Progress (was 15%) is dropped: `computePulseScore` marks
  the goals component non-applicable when the flag is off, and the score
  **renormalises over the remaining components** (Budgets / Savings / Trend / Debt)
  via the existing applicable-weight logic — no manual reweighting. `PulseGauge`
  no longer renders the Goals row.
- **UI surfaces gated** — Goals nav item (`Sidebar`), the `/goals` route (redirects
  to dashboard), the Dashboard "Active goals" panel (donut now spans full width),
  the Add-FAB "Add goal" + the `g` keyboard shortcut (`Layout`), and the Ask Vyact
  goal chips (`Chat`). The Goals page, modals, and store actions remain in the
  codebase, dormant.
- **Regression** — the aggregation golden file was updated deliberately: the only
  diff is the Pulse `goals` component (40 → 0), confirming nothing else shifted.
  Transfer invariant intact.

### Validation
- Typecheck 0 errors; full suite 126/127 (the one failure is the pre-existing,
  unrelated `calculations` debt assertion); production build clean.
- **Ran the app in a local dev server** (Vite, local-only mode): boots and serves
  HTTP 200, and all edited modules (`features`, `calculations`, `PulseGauge`,
  `Dashboard`, `Goals`, `Budgets`, `Accounts`) transform cleanly through the dev
  pipeline. (The only runtime log error is the unrelated third-party
  `@userback/widget` init, which needs its network/key.) Full visual click-through
  needs an interactive browser session not available in this environment — run
  `cd react && npm run dev` locally to see it.

## v8.5.0 — Money-Model Epics 2 & 3 UI (budgets, goals lens, tax nudge) *(2026-06-07)*

Lands the user-facing surfaces for Epics 2 & 3 over the v8.3.0 engines, all gated
by their epic flags (OFF → the pages are byte-for-byte the prior version).

### Epic 2 — Budgets (`pages/Budgets.tsx`, `budgetsV2`)
- **B2.4 suggested budgets** — a "Suggest" header action proposes budgets for
  categories the user doesn't yet track, sourced from `suggestBudget()` (recurring
  + debts + goals + 3-month history). Editable, checkbox-selectable proposal panel;
  each line shows its basis; confirmed lines create real budgets with a
  deterministic colour. Read-only inference, no phantom money (A8).
- **B2.2 budget history** — a 6-month budget-vs-actual mini-timeline (`budgetHistory()`)
  with per-month variance, answering "are we improving?" at a glance.

### Epic 3 — Goals & Tax as lenses (`pages/Goals.tsx`, `goalsLens` / `taxNudge`)
- **B3.1 goals-as-lens** — an explainer that goals track *progress toward a target*
  with money never carved out of an account (A4); real-account backing is the
  opt-in path (engine `goalsLens.ts` ready; needs a `Goal.linkedAccountId` field
  to expose the link UI).
- **B3.2 tax nudge** — a derived "you'll likely owe ~X; reserved Y" card from
  `computeTaxNudge()` (income × a v1 flat rate) measured against a real **Tax
  Reserve** account's balance. No tax entity, no phantom balance (A5).

### Status
- Typecheck + build clean; suite green except the one pre-existing unrelated
  `calculations` assertion. Golden file + transfer invariant intact. All new UI
  OFF by default.
- **Remaining (deliberately deferred):** B2.3 category allocations (needs a budget
  sub-limit schema field; `rollupAllocations()` engine ready) and B4.2/B4.3 txn-
  form reshape (OFF-by-default UX polish inside the core entry modal — held to
  avoid blind surgery on the critical add/edit flow). B4.5 re-theme PARKED per spec.

## v8.4.0 — Money-Model Epic 1: B1.6 backfill + account ledger UI *(2026-06-07)*

Completes the Epic 1 gate and lands its flagship UI over the v8.3.0 engine.

### B1.6 — account backfill (the R2-gated migration), applied to prod
- **Read-only dry-run first (R2 discipline):** confirmed 0 orphans after backfill,
  1 accountless txn to repair, 2 households needing a system Cash account, and
  `global_net = 193592.90` (the invariant the backfill must not change).
- **Applied** [`20260607130000_v8_money_model_b16_account_backfill.sql`](../supabase/migrations/20260607130000_v8_money_model_b16_account_backfill.sql):
  idempotent + amount-invariant — creates a system Cash account per household
  (only setting `is_default` when no default exists for the currency, respecting
  `accounts_default_per_currency`) and repairs accountless transactions to the
  Cash funding source via `extras.paymentMethod`. **Post-apply verified:** 0
  orphans, 2 cash accounts, `global_net` unchanged at 193592.90. (Full uuid-FK
  normalization of `transactions.account_id` is intentionally deferred — the app
  keys account membership off the encoded `paymentMethod` string the engine reads.)

### Account ledger UI (B1.2/B1.3/B1.4) — `pages/Accounts.tsx`
- Each account row now shows its **computed balance** (`computeAccountBalance`,
  B1.2) with an `est` tag when provenance is unconfirmed; a **Fix balance**
  inline action (B1.3) that calls the `reconcileAccount` store action → writes a
  dated Balance Adjustment (never overwrites); and an expandable **per-account
  ledger** (B1.4) — reverse-chronological entries with per-row impact + running
  balance. All three gated by `moneyModel.openingBalance` / `reconciliation` /
  `ledger` — **flags OFF → the v7.1.3 Accounts page exactly** (no balance column,
  no reconcile, no ledger).

### Status
- Typecheck + build clean; suite green except one pre-existing unrelated
  `calculations` assertion. Golden file + transfer invariant intact.
- **Epic 1 is now functionally complete and gate-passed** (golden-file clean,
  migration reconciled, transfer invariant green) — ready to enable behind
  `moneyModel` after a live QA pass.
- **Remaining (engines ready, UI pending):** budget timeline/allocations UI
  (B2.2/B2.3), suggested-budget confirm flow (B2.4), goals-reframe + tax-nudge UI
  (B3.1/B3.2), and the txn-form reshape (B4.2/B4.3). All behind their OFF flags.

## v8.3.0 — Money-Model Overhaul: engines for all four epics *(2026-06-07)*

Lands the tested, regression-critical **engine + data layer for Epics 1–4** of the
[money-model program](../vyact-money-model-execution-and-regression.md), all behind
OFF-by-default flags (app stays exactly v8.2.0 until each flag flips). Part A
governs throughout: services compute, the assistant/UI only present; no phantom
balances. The new heavy screens are now thin presentation over these engines.

### Epic 1 — Money Feels Real (engine)
- **DB (additive, applied):** `accounts.opening_balance` + provenance columns
  (`confidence`/`source`/`estimated_at`/`confirmed_at`), migration
  [`20260607120000_v8_money_model_account_opening_balance.sql`](../supabase/migrations/20260607120000_v8_money_model_account_opening_balance.sql);
  mapped through `supabaseAdapter` account row mappers + the `Account` type.
- **B1.2 real balances** — new [`lib/accountBalance.ts`](src/lib/accountBalance.ts):
  `computeAccountBalance()` = opening + credits − debits over the real txn encoding
  (income credits, expense debits, transfer debits source + credits dest).
- **B1.3 reconciliation** — `reconcileAccount()` emits a dated **Balance Adjustment**
  transaction for the delta (never a silent overwrite, R4) and marks the balance
  `confirmed`; wired as a store action `reconcileAccount(account, realBalance)`.
  Balance Adjustments are excluded from `reportableTxns` (they move an account but
  are corrections, not spend/earn — they never pollute income/expense/category
  totals) yet still move the account balance.
- **B1.1 account-on-every-transaction** — `upsertTransaction` defaults the funding
  source to the system Cash account when none is chosen (behind
  `moneyModel.enforceAccount`), so the A2 invariant never blocks fast entry.

### Epic 2 — Budgets (engine) — `lib/budgetIntel.ts`
- B2.4(a) `copyBudgets()`, B2.4(b) `suggestBudget()` (read-only inference over
  recurring + debts + goals + 3-month history, each line traceable to its basis —
  A8, no phantom money, no LLM), B2.2 `budgetHistory()` (month-by-month budget vs
  actual + variance), B2.3 `rollupAllocations()` (allocated/unallocated + over-
  allocation warning, A1 transparency). B2.1 colour picker removal shipped in v8.2.0.

### Epic 3 — Goals & Tax as lenses (engine) — `lib/goalsLens.ts`, `lib/taxNudge.ts`
- B3.1 `goalProgress()` — virtual goals **count tagged contributions** (no sub-
  balance carved from an account) and contribute **zero** to Net Worth (R3);
  opt-in real-account-backed goals read the linked account's live balance and
  count once as that asset. `goalContributesToNetWorth()` enforces R3.
- B3.2 `computeTaxNudge()` — tax owed derived from income × rate, surfaced as a
  nudge against a real **Tax Reserve** account's balance; no tax entity, no phantom
  balance (A5).

### Epic 4 — Entry & surface polish
- B4.1 (no keypad auto-launch) + B4.4 (Saved Views hidden) shipped in v8.2.0.
  B4.2/B4.3 (form reshape) remain staged behind `entryV2.shortForm` (pure
  presentation). B4.5 re-theme PARKED per spec.

### Safety
- Aggregation **golden file stays green** — the `reportableTxns` adjustment-
  exclusion is a no-op on existing data; transfer invariant intact (R1).
- 18 new engine tests (`CON-UNIT-MM-100..123`) + the 6 baseline tests. Typecheck +
  build clean; suite green except one pre-existing unrelated `calculations` assertion.
- **All money-model behaviour is OFF by default.** Remaining before enabling in
  prod: the per-account-balance UI/ledger screen, reconciliation modal, budget
  timeline/allocation UI, goals-reframe + tax-nudge UI, and the B1.6 transaction
  `account_id` backfill migration with a dry-run reconciliation (R2).

## v8.2.0 — Money-Model Overhaul: flags, regression safety net, quick wins *(2026-06-07)*

First landing of the [Money-Model Overhaul program](../vyact-money-model-execution-and-regression.md).
Follows the spec's own discipline: **build the flags + verify the OFF-state, lay
down the mandated regression safety net (Part C) before Epic 1 touches the money
model, and ship the three "extractable anytime" quick wins.** The risky Epic 1
data-model + migration core (B1.1–B1.6) is scaffolded behind OFF flags and lands
next, gated on this safety net.

### Program flags (Part D) — `src/config/features.ts`
- Added `moneyModel` (umbrella + `enforceAccount` / `openingBalance` /
  `reconciliation` / `ledger` / `scopedCategories`), `budgetsV2`, `goalsLens`,
  `taxNudge`, `entryV2` — all Epic cores default **OFF** (app indistinguishable
  from v8.1.2). Quick-win sub-flags default to their improvement and are
  individually reversible.

### Regression safety net (Part C / C4) — `lib/__tests__/moneyModel.regression.test.ts`
- **Golden-file** of the whole aggregation engine for a representative fixture
  household (`monthlyData`, `totalBalance`, `spendByCategory`, `reportableTxns`,
  Net Worth, Pulse components, `aiSummary`) — the v8.1.2 baseline every Epic-1 PR
  must diff against (C4.1). Plus hand-computed assertions so the numbers are
  human-checkable.
- **Transfer invariant suite** (R1/C4.3): transfers — both the single-row model
  and the legacy paired `__tg:` encoding — never move spend/income totals or Net
  Worth. This is the critical-risk guard for the new From→To transfer model.

### Quick wins (extractable anytime, no Epic-1 dependency)
- **B2.1 (alpha 2) — colour picker removed.** `BudgetFormModal` no longer shows a
  swatch picker; colour is derived deterministically from the category via new
  `deterministicColor()` (stable hash → palette, known categories keep their own
  colour). Reversible via `budgetsV2.removeColorPicker`.
- **B4.1 (alpha 11a) — no keypad auto-launch.** `TransactionFormModal` drops
  `autoFocus` on open/edit (gated by `entryV2.stopAutofocus`), so edits can land on
  a non-amount field and the keypad no longer ambushes the user.
- **B4.4 (alpha 3) — Saved Views hidden by default.** `SavedViewsBar` returns null
  behind `entryV2.showSavedViews` (a thin wrapper, no conditional hooks). The
  `saved_views` table + RPC stay **dormant, not deleted** — re-enableable for power
  users, preserving the v7.3.0 work.

### Notes
- No schema change; no Epic-1 money-model behaviour shipped yet (flags OFF).
- Typecheck + build clean; 6 new money-model tests green; full suite green except
  one pre-existing, unrelated `calculations` debt-component assertion.

## v8.1.2 — Realtime refresh race, currency-in-drawer, DB cleanup *(2026-06-06)*

Three triaged fixes.

### Dashboard totals froze after a couple of transactions (cloud mode)
- **Root cause.** The realtime subscription fired `get().refresh()` on *every*
  `postgres_changes` event with no debounce or ordering. A single user action can
  emit a burst (e.g. a transfer's paired rows; rapid adds), spawning overlapping
  full re-lists that resolved **out of order** — an older snapshot (a cloud read
  that lagged a just-written row) could resolve last and overwrite newer state,
  so income/expense totals stuck at a stale value.
- **Fix** ([`store.ts`](src/store.ts)): (1) a module-scoped `refreshSeq` —
  `refresh()` captures a sequence + the active household and **discards its result
  if a newer refresh started or the household switched** mid-flight; (2) the
  realtime handler is **debounced 400ms** so an event burst collapses into one
  trailing refresh after the writes settle.

### Currency change not reflected in the menu drawer
- **Root cause.** `updateProfile({ baseCurrency })` wrote `households.base_currency`
  and updated `store.profile` (so Dashboard and Reports reconvert correctly — they
  read `profile.baseCurrency`), but it never updated the `households` array that
  the profile switcher / menu drawer renders, so the drawer's `· {currency}` label
  stayed stale until a full reload.
- **Fix** ([`store.ts`](src/store.ts)): `updateProfile` now patches the active
  `HouseholdMeta` in the in-memory `households` list when `baseCurrency`/`household`
  type changes — no extra network call. Dashboard/Reports were already correct;
  validated they recompute on `baseCur`.

### DB cleanup — dropped dead `households.baseline_provenance`
- Removed the legacy `households.baseline_provenance` jsonb column (residue from an
  early v8 onboarding draft; the shipped design uses normalized
  `confidence`/`source` columns on the entity tables and never read it). Migration
  [`20260606140000_v8_drop_legacy_baseline_provenance.sql`](../supabase/migrations/20260606140000_v8_drop_legacy_baseline_provenance.sql)
  drops + recreates `my_households` around the column drop; applied to production.
  Audited `households`/`profiles`/entity tables — no other legacy onboarding
  columns exist (`households.onboarding` and the entity provenance columns are
  live). Typecheck + build clean; suite green (one pre-existing unrelated
  `calculations` assertion).

## v8.1.1 — Hotfix: my_households 400 blocked app load *(2026-06-06)*

**Severity: app-blocking.** `GET /rest/v1/my_households?select=…,onboarding`
returned **400** for all cloud users, failing `listHouseholds()` during `init()`
and leaving the app stuck on load.

**Root cause.** The v8 onboarding migration added `households.onboarding`, but the
`my_households` view was created with an expanded column list — Postgres freezes
`select h.*` into explicit columns at creation, so a new base-table column is
**not** added to the view. Selecting `onboarding` from the view hit a non-existent
column → 400.

**Fix (two parts).**
- **DB** — new migration
  [`20260606130000_v8_fix_my_households_view.sql`](../supabase/migrations/20260606130000_v8_fix_my_households_view.sql)
  drops and recreates `my_households` (no dependent views) so `h.*` re-expands to
  include `onboarding`; `security_invoker` + `grant select` restored. Applied to
  production immediately.
- **Client (defense-in-depth)** — [`supabaseAdapter.ts`](src/lib/supabaseAdapter.ts)
  `listHouseholds()` now selects `onboarding` and, on any error, **retries without
  it** instead of throwing. An additive column that hasn't reached a given
  environment's view can never again hard-block the whole app; `onboarding` simply
  reads as `undefined` until the migration lands. Typecheck clean.

## v8.1.0 — Ask Vyact assistant (deterministic, no-LLM) *(2026-06-06)*

Grows the existing Ask Vyact launcher into a real three-bucket assistant —
**Capture, Interpret, Forecast** — using a deterministic, on-device, **no-LLM**
pipeline in a warm human voice, behind a single feature flag, architected so a
future LLM is a drop-in behind two function signatures. Built to
[`vyact-ask-vyact-engineering-spec.md`](../vyact-ask-vyact-engineering-spec.md).
**The assistant phrases; existing services compute** — no figure it says is ever
produced by a template.

### Feature flag (built first)
- Extended [`src/config/features.ts`](src/config/features.ts) with
  `FEATURES.askVyact` (`enabled`, per-bucket `capture`/`interpret`/`forecast`,
  `proactiveInsight`, `backend: 'rules'|'llm'`) + `isAskVyactEnabled()` /
  `isAskVyactBucketEnabled()`. **`enabled = false` reverts the launcher to its
  exact v7.4.5 two-tap behaviour** — no free-text parsing, no buckets, no
  proactive insight, no new events. Per-bucket flags allow staged rollout.

### The five-stage pipeline (two seams for the future LLM)
- [`lib/askVyactParser.ts`](src/lib/askVyactParser.ts) — stages 1–2 (`normalise`
  + `entityExtract`): pure amount parsing (k / lakh / cr / grouped / currency),
  a contained keyword→category map, split participant counts, and forecast
  horizons. Model-agnostic; reused forever.
- [`lib/askVyactIntents.ts`](src/lib/askVyactIntents.ts) — **extended** with the
  free-text taxonomy + `classifyIntent()` (stage 3, the first LLM seam). Ordered
  rules: Forecast/Interpret tested before Capture so a question never seeds a
  transaction; income before expense; goal-vs-runway ordering.
- [`lib/askVyactResponses.ts`](src/lib/askVyactResponses.ts) — `phraseResponse()`
  (stage 5, the second seam) with **≥3 warm phrasing variants per intent+outcome**,
  answer-first, never a dead end, honest about estimates.
- [`lib/askVyactBackend.ts`](src/lib/askVyactBackend.ts) — `resolve()` (stage 4,
  **never delegated to a model**) computes purely via existing services
  (`spendByCategory`, `liquidAssets`, `monthlyData`, Planner-style affordability /
  runway / goal / prescriptive). Ships `RulesBackend` and a stub `LlmBackend`
  (inherits stages 1/2/4 unchanged); `selectAssistantBackend()` picks per flag;
  `runAssistant()` orchestrates; `proactiveInsight()` surfaces one ranked card.

### Buckets
- **Capture** — "spent 45 on fuel", "got paid 85000", "split 3600 4 ways",
  "moved 10k" → seeds the **existing** `TransactionFormModal` via `openAddTxn`;
  missing amount → one clarifying chip, not a re-ask.
- **Interpret** — lookups vs budget, status (Pulse / net worth / balance),
  diagnostic (category vs rolling average). Numbers match the dashboard exactly;
  estimate-derived figures are flagged in the phrasing (v8.0.1 provenance).
- **Forecast** — affordability (liquid − emergency floor), runway (liquid ÷ burn),
  goal pace vs deadline, prescriptive trims of discretionary categories. Always a
  constructive alternative on "no"; no specific securities/products (guardrail).

### Wiring + privacy
- [`pages/Chat.tsx`](src/pages/Chat.tsx) routes free-text through `runAssistant`
  when enabled (capture seeds the modal), shows one dismissible proactive card per
  session, and keeps the privacy-safe `logAiUsage` event. All parsing is
  on-device — no utterance leaves the client (there is no LLM call to make).

### Tests
- New [`lib/__tests__/askVyact.test.ts`](src/lib/__tests__/askVyact.test.ts) —
  18 tests (`CON-UNIT-ASK-001..053`): the 11 capture + 8 forecast reference
  phrasings, interpret routing, missing-amount clarify, figures traced to
  services, provenance flagging, ≥3 variants per intent+outcome, fallback warmth,
  and the `LlmBackend` stub-swap (identical stages 1/2/4). Typecheck + build
  clean; 18/18 green (full suite green except one pre-existing, unrelated
  `calculations` debt-component assertion).

## v8.0.1 — Onboarding cloud persistence (multi-device) *(2026-06-06)*

Closes the v8.0.0 gap where onboarding state lived only in browser-local overlays
— which meant a second device or a cleared cache silently lost the "Estimated"
tags, the "% confirmed" indicator, the 21-day window, and nudge bookkeeping. Both
halves of the module are now cloud-persisted and follow the household across
devices. Requires DB migration
[`20260606120000_v8_onboarding_state.sql`](../supabase/migrations/20260606120000_v8_onboarding_state.sql).

### (a) Per-household state → `households.onboarding` (jsonb)
- New jsonb column on `households` holding the `HouseholdOnboarding` record
  (state, segment, context, currentStep, completedAt, 21-day window), with a
  `jsonb_typeof = 'object'` guard. Inherits the existing `households` RLS.
- [`onboardingState.ts`](src/lib/onboardingState.ts) keeps a synchronous
  localStorage **cache** (so the UI read API and offline / local-only mode keep
  working) and adds a cloud **write-through**: `registerOnboardingSync()` (the
  store registers an `updateHousehold({ onboarding })` persister in cloud mode, a
  no-op in local mode) and `hydrateOnboardingFromCloud()` (seeds the cache from
  the authoritative cloud value on load). [`supabaseAdapter.ts`](src/lib/supabaseAdapter.ts)
  selects/maps `onboarding` in `listHouseholds` + `updateHousehold`; the
  `my_households` view is `select h.*` so the column flows through automatically.
  Wired in [`store.ts`](src/store.ts) `init()`.

### (b) Record provenance → normalized columns on entity rows
- Replaced the local provenance overlay with real `confidence` / `source` /
  `estimated_at` / `confirmed_at` columns on every baseline-derived table
  (`transactions`, `budgets`, `goals`, `debts`, `assets`), defaulting to
  `'confirmed'` / `'user'` so **no backfill is needed and existing data is never
  re-tagged** (spec §3.4). A partial index per table (`… where confidence <>
  'confirmed'`) makes outstanding estimates cheap to find. Provenance now rides
  the existing per-entity sync + RLS, survives a cache clear, and is queryable in
  SQL.
- `WithProvenance` mixed into `Transaction` / `Budget` / `Goal` / `Debt` / `Asset`
  in [`types.ts`](src/types.ts); the adapter maps the columns via shared
  `provToRow` / `rowToProv` helpers. [`Onboarding.tsx`](src/pages/Onboarding.tsx)
  now stamps `onboardingProvenance()` directly onto seeded budgets/goals (so the
  estimate state persists through the normal entity write).
- Provenance helpers moved onto entity collections: `isEstimate`,
  `unconfirmedEstimateCount`, `confirmedPctFromEntities` (materiality-weighted).
  [`NudgeBanner.tsx`](src/components/onboarding/NudgeBanner.tsx) derives the nudge
  stats from store entities; [`onboardingNudges.ts`](src/lib/onboardingNudges.ts)
  takes `{ unconfirmedEstimates, confirmedPct }` as inputs.

### Notes
- The per-household onboarding *trigger* was already multi-device-safe via the
  cloud-synced `profile.onboardedAt`; this release makes the *honest-data
  lifecycle* equally durable.
- Tests updated to the entity-based provenance APIs (`CON-UNIT-ONB-007..010`,
  `011..016`). Typecheck clean; 16/16 onboarding tests green; full suite green
  except one pre-existing, unrelated `calculations` debt-component assertion.

## v8.0.0 — Onboarding & Activation module *(2026-06-06)*

Major release. Ships the **per-household Onboarding & Activation** feature defined
in [`vyact-onboarding-engineering-spec.md`](../vyact-onboarding-engineering-spec.md):
a minimal baseline-capture flow (a snapshot + a recurring scaffold — **never** a
bank statement) that renders a useful dashboard in under two minutes, with
estimated values that converge to confirmed reality over a **21-day** window. The
whole feature sits behind a single feature flag and is built so that turning it
off is a clean no-op. Bumped to a major because this is a new product surface with
its own state model, not a polish patch.

### Feature flag (plug-n-play) — built first
- New [`src/config/features.ts`](src/config/features.ts) `FEATURES.onboarding`
  config object: `enabled` master switch, `perHousehold`, `confirmationWindowDays: 21`,
  `skipAllowedFromStep: 2`, plus `isOnboardingEnabled()`. Single swap-point for a
  server-driven remote-config service later (H2). With `enabled = false` no
  onboarding UI renders, new households are created `skipped`, no estimated data
  is seeded, no nudges fire, and no "% confirmed" indicator shows — the app is
  indistinguishable from the pre-feature build.

### Per-household state model + provenance
- New [`src/lib/onboardingState.ts`](src/lib/onboardingState.ts): the per-household
  state machine (`not_started → in_progress → completed / skipped`) with resume
  support, the 21-day window (`confirmationWindowEndsAt = completedAt + 21d`), and
  a record-level provenance overlay (`Confidence = estimated|confirming|confirmed`,
  `Source = onboarding|user|bank`). `confirmRecord()` never auto-overwrites a value
  (explicit tap only); `confirmedPct()` is materiality-weighted. Persisted as a
  namespaced `localStorage` overlay per the documented "client-side overlay for
  un-migrated schema" convention — **no Supabase schema change**.
- **Existing households are safe:** `migrateExistingHousehold()` marks any
  pre-feature / data-bearing household `skipped` and is idempotent; existing data
  is treated as `confirmed` and **never** re-tagged as an estimate. No existing
  user is ever re-onboarded.

### The 6-step flow (segment-driven)
- Rewrote [`src/pages/Onboarding.tsx`](src/pages/Onboarding.tsx) from the old
  4-step template wizard to the spec's **six-step spine**: Welcome+Trust →
  Segment Select (mandatory) → Context → Snapshot → Forward Model → Reveal. Steps
  2–4 read content from a per-segment map and are skippable from step 2. Steps 2–4
  are capped at ≤6 input interactions; **no bank-connect / statement / account-number
  / card field anywhere** in the flow. Seeds provenance-tagged `estimated` budgets
  and a debt goal (reusing existing entities, not parallel models).
- New [`src/lib/onboardingTemplates.ts`](src/lib/onboardingTemplates.ts): the
  per-segment content map for **individual / household / smb** — context questions,
  snapshot fields, fixed-cost chips, visible modules, Pulse bias, and the signature
  Reveal line.
- The **Reveal** shows current position, monthly cash-flow shape, first Pulse
  Score, 21-day outlook, the "% confirmed" indicator (starts ~40%), and one
  suggested next action (partner-invite for households).

### Per-household trigger — auth-method-agnostic
- [`src/App.tsx`](src/App.tsx) routes a genuinely fresh household into the flow on
  first entry and migrates existing households to `skipped`. The guard keys off
  household state, **not** how the user authenticated — so email **and** Google
  OAuth sign-ups (both land on `/auth/verified → /dashboard`) flow through
  onboarding automatically. (Google SSO itself remains the v7.0.1 "coming soon"
  stub until the provider is configured; no extra wiring needed when it lands.)
  Invited members joining a `completed` household skip baseline capture (§6.4).

### Honest-data rendering
- New shared [`src/components/ui/EstimatedTag.tsx`](src/components/ui/EstimatedTag.tsx):
  any value whose `confidence !== 'confirmed'` renders the tag, so an estimate
  always looks like an estimate and is never styled as real/confirmed data.

### Progressive-capture nudges
- New [`src/lib/onboardingNudges.ts`](src/lib/onboardingNudges.ts) decision engine
  + [`src/components/onboarding/NudgeBanner.tsx`](src/components/onboarding/NudgeBanner.tsx)
  surface (mounted once at app root). One gentle, dismissible nudge at a time with
  priority **check-in (day 7/14/21) → confirm-estimate → bank-connect**. Governance:
  non-blocking, dismissals persist, **max one nudge per session**, active nudging
  **tapers after the 21-day window**, and the **bank-connect offer never appears at
  signup** — only after ≥5 real logs, once. Counts only real activity (onboarding
  estimates excluded).

### Instrumentation
- [`src/lib/analytics.ts`](src/lib/analytics.ts): added `onboarding_started`,
  `onboarding_skipped`, `onboarding_completed`, `onboarding_nudge_shown/dismissed`,
  `estimate_confirmed`, `confirmed_pct_milestone`, `bank_connect_offered` events
  and their privacy-safe params (segment, durations, baseline counts, days-since).

### Tests
- New [`src/lib/__tests__/onboarding.test.ts`](src/lib/__tests__/onboarding.test.ts)
  — 16 unit tests (`CON-UNIT-ONB-001..016`) covering the state machine, the 21-day
  window, the no-re-onboard guarantee, provenance + materiality-weighted "% confirmed",
  and all nudge governance rules. Typecheck clean; production build clean; 16/16 green.

### Deferred (follow-ups)
- Dashboard-resident "% confirmed" widget and chart hatching for estimated-vs-confirmed
  segments. The state + provenance data is in place; only the dashboard surfaces remain.
- Real Google OAuth (gated on Supabase provider config, tracked since v7.0.1).

## v7.4.7 — User feedback & heatmap analytics integration *(2026-06-05)*

Two telemetry integrations for product insights and user feedback collection.
No data exposure: financial data (transactions, budgets, balances) stays client-side
in localStorage / cloud-encrypted. Third-party collectors only see behavioral signals
(clicks, scrolls) and structured feedback from users.

### Hotjar via ContentSquare (session heatmaps & recordings)
- Injected heatmap tracking script `https://t.contentsquare.net/uxa/86f8fcfc0d114.js`
  into `react/index.html` (production builds only).
- Captures scroll depth, click/tap zones, mouse movement trails, and session video for
  product research (which features get used, where users click, bounce patterns).
- **No access to:** localStorage, form fields, sensitive data.
- Heatmap data exported to admin dashboard for monthly product reviews.

### Userback widget (user feedback + screenshot annotation)
- `@userback/widget` npm package (`v0.3.12`) initialized in `src/main.tsx` at app startup
  with project key `A-7Q0Mz7gfB3ECVu6ZsOIUew97E`.
- Floating action button (lower-right) lets users screenshot the current page, annotate
  with arrows/text, type a message, and submit to the support backlog.
- Auto-attaches browser info (user agent, resolution), timestamp, page URL.
- **No access to:** localStorage, console, network traffic, form data.
- Feedback routed to #support-feedback Slack channel for triage.

### Deployment
- Both integrations are **no-op in local-only mode** (neither fires without cloud setup).
- Vercel production builds will wire both automatically (no env-var gates needed).
- No new dependencies besides `@userback/widget` (Hotjar is a third-party script).
- No schema changes. Typecheck clean.

---
## v7.4.5 — Mobile edge-swipe, header polish, FAB layering, iOS install suppression, Ask Vyact two-tap *(2026-06-05)*

Six small but visible polish items requested after v7.4.4 shipped. No
schema or migration changes; pure client/UX work.

### Phase 1 — Mobile edge-swipe opens sidebar
- `useEdgeSwipe()` hook in `hooks.ts` listens for left-edge touch starts
  (`x < 24px`) followed by a >60px rightward drag inside 400ms with
  vertical noise <40px. Wired into `Layout.tsx` to open the sidebar.
  Gated to `window.innerWidth < 1024` so desktop pointer events are
  untouched.
- `useSwipeToClose()` mirror — left-swipe on the open mobile drawer
  closes it. Attached to `Sidebar.tsx`'s `<aside>` ref. Active only when
  `open === true`, so the gesture is dead during desktop docked state.

### Phase 2 — Dashboard "Add Transaction" button removed
- Per user request the Dashboard header CTA was redundant with the
  global Add FAB. Removed the button + `Plus` icon import + `openAddTxn`
  store subscription. Header collapses to greeting + subtitle.
- `openEditTxn` retained — Recent Transactions click-to-edit still works.

### Phase 3 — FAB stack desktop spacing
- `FloatingTools.tsx` (Planner + Ask Vyact bubble) was at
  `lg:bottom-[88px]`, overlapping the Add-FAB area on desktop. Moved to
  `lg:bottom-[160px]` to match mobile. Visual gap of ~24px above the
  Add-FAB (which sits at `safe-area + 80px`).

### Phase 4 — Header normalisation
Aligned Transactions, Recurring, and Budgets headers with the canonical
Goals / Debts / Net Worth pattern.
- Removed `flex-wrap` from the header row; added `min-w-0` to the title
  block and `flex-shrink-0` to the right action group so the CTA stays
  on the same line as the title at narrow widths.
- Replaced `<Button variant="primary">+ Add ...</Button>` with the raw
  `<button className="btn-primary">+ Add ...</button>` matching the
  other pages.
- Transactions: shrunk the calendar toggle to a compact `h-[34px]`
  rounded-md icon button.
- Budgets: hid the period/monthly view toggle on `< sm` so it doesn't
  fight the CTA on phones.

### Phase 5 — iOS install banner suppressed; **TD-22** filed
- iOS Safari has no programmatic `beforeinstallprompt`, so the v7.3.4
  banner showed an instructional "tap Share → Add to Home Screen"
  message. User feedback: this is annoying noise. **Decision: pure
  suppression on iOS.** `InstallBanner.tsx` early-returns when
  `isIos()` is true. Android/desktop Chrome/Edge native prompt path is
  unchanged.
- During the audit we confirmed the "Push notifications" Settings
  toggle is **only a stored preference** — there is no
  `Notification.requestPermission`, no service-worker push handler, no
  VAPID keys, no `push_subscriptions` table, no Edge Function. Filed
  **TD-22** in `TECH_DEBT.md` with a 4-phase remediation plan
  (foundation → subscribe → delivery → settings UI). The toggle still
  surfaces because a future v7.5 ships the actual implementation.

### Phase 6 — Ask Vyact two-tap quick actions
Replaces the six hardcoded "Try asking" prompts with a bucketed,
two-tap launcher:

- **Capture** — Add expense / income / transfer / investment / goal /
  budget / debt / asset. Add-expense and add-income expand to a tap-2
  row of common categories (Groceries, Fuel, Eating out, Shopping,
  Bills, Other for expenses; Salary, Freelance, Gift, Other for
  income). The chosen chip seeds the global Add-Transaction modal with
  `{ type, category }` so the user lands on a pre-filled form.
- **Inquire** — Spend this month, Pulse Score, Net worth, Budgets at
  risk, Top categories, Upcoming bills. These flow through the
  existing `selectChatBackend()` pipeline (deterministic stub or
  Gemini if `VITE_GEMINI_API_KEY` is configured).
- **Plan** — Emergency fund, Debt strategy, Goal ETA. Same flow.
- **Manage** — Open Budgets / Net Worth / Households (router push).

Architecture:
- New `lib/askVyactIntents.ts` exports a typed `Intent[]` registry +
  `IntentAction` discriminated union (`open-modal | navigate | ask`).
  All UI dispatching is one switch in `Chat.tsx`.
- New store slot: `seedTxn: Partial<Transaction> | null` with
  `openAddTxn(seed?)`, threaded through `closeTxnModal` to clear on
  close. `TransactionFormModal.tsx` reads `storeSeed` and merges
  `{type, category, amount, currency, description, note, date}` into
  the blank form when not editing. Track-picker is bypassed when seed
  carries a `type`.
- Free-text input still routes to `backend.ask()` — power users keep
  the long-form Q&A flow.
- Telemetry: `console.debug('[ask-vyact-intent]', { id, taps })` —
  privacy-safe (no message text).

### Files touched
- `react/src/hooks.ts` (added swipe hooks)
- `react/src/components/layout/{Layout,Sidebar,FloatingTools,InstallBanner}.tsx`
- `react/src/components/transactions/TransactionFormModal.tsx`
- `react/src/pages/{Dashboard,Transactions,Recurring,Budgets,Chat}.tsx`
- `react/src/store.ts` (seedTxn slot)
- `react/src/lib/askVyactIntents.ts` (new)
- `TECH_DEBT.md` (TD-22)

---
## v7.4.6 — Transactions header overlap fix + one-click update refresh *(2026-06-05)*

Two surgical follow-ups to v7.4.5, both reported the same day the v7.4.5
build went live. No schema or migration changes.

### Transactions header layout fix
- The `<CalendarDays>` toggle button shared the title row with the
  `+ Add Transaction` CTA, and on narrow widths the calendar pill
  overlapped the heading text. Moved the Calendar toggle off the title
  row onto the existing toolbox row that already hosts the Saved Views
  controls. Calendar is now left-aligned, **Views** + **Save View** stay
  right-aligned. `flex-wrap` on the toolbox row keeps it tidy on
  phone widths.

### One-click "Refresh to update"
- Reports said the update banner needed 4–5 clicks before the new
  version appeared. Root cause: `version.json` had drifted, but the
  service worker was still serving precached HTML/JS, so a plain
  `window.location.reload()` returned the *old* build. The banner
  reappeared each time until the SW eventually self-updated.
- New `forceReloadForUpdate()` helper in `lib/pwa.ts` makes a single
  click decisive:
  1. Calls `registration.update()` to force a network re-check for
     `sw.js`. If a waiting worker materialises, message `SKIP_WAITING`
     and reload on `controlling`.
  2. Otherwise unregisters every service worker, purges Cache Storage,
     then hard-reloads with a cache-busting `_v` query param so the
     document and all subresources hit the network.
- `UpdateBanner.tsx` calls the new helper, disables the button while
  refreshing, and shows a spinning icon + "Refreshing…" label so the
  user gets immediate feedback after the single click.

### Files touched
- `react/src/pages/Transactions.tsx` (header / toolbox row reshuffle)
- `react/src/lib/pwa.ts` (`forceReloadForUpdate`)
- `react/src/components/layout/UpdateBanner.tsx` (one-click flow + spinner)

---
## v7.4.4 — Settings password, dashboard navigation, txn click-to-edit, multi-entry Add, number-system fix *(2026-06-04)*

Four UX upgrades and one persistence bug fix bundled together.

### Added
- **Change-password card in Settings** ([Settings.tsx](react/src/pages/Settings.tsx)). New panel before MFA: enter new password, confirm, optional show-passwords toggle, Save. Reuses the existing `updatePassword()` helper in [auth.ts](react/src/lib/auth.ts). Validates length ≥ 8 and matching fields. Gated on `cloudEnabled && session`; local-only mode shows a muted hint instead. The user stays signed in on the current device after the update.
- **Dashboard cards are now navigable** ([Dashboard.tsx](react/src/pages/Dashboard.tsx)). Whole-card click targets:
  - **Pulse Score** → `/reports`
  - **Total Balance** → `/networth`
  - **Monthly Income** → `/transactions?type=income`
  - **Monthly Expenses** → `/transactions?type=expense`
  - **Savings Rate** → `/budgets`
  - **Spending by Category** panel → `/reports`
  Each wrapper carries a focus ring and `aria-label` for keyboard / screen-reader use.
- **Deep-link filter seed in Transactions** ([Transactions.tsx](react/src/pages/Transactions.tsx)). The page now reads `?type=` and `?cat=` from the URL on mount and seeds the type / category selects. Params are stripped after seeding so a refresh respects user changes.
- **Recent transactions on Dashboard are click-to-edit.** The recent-transactions list now passes `showActions` and `onEdit={openEditTxn}` to `<TxnRow>`, so a tap or Enter opens the same `TransactionFormModal` that the Transactions page uses.
- **Always-available `AddFab`** — new component [AddFab.tsx](react/src/components/layout/AddFab.tsx). 56px coral primary FAB pinned to the bottom-right, respecting `env(safe-area-inset-bottom)` and sitting above the `MobileBar`. Auto-hides on scroll-down so it doesn't block content; reappears on scroll-up. Hidden on `/auth/*` routes.
- **Speed-dial on the FAB.** Long-press (touch) or right-click (desktop) opens a small dial with **Add Goal**, **Add Budget**, **Add Debt**, **Add Asset**. Plain tap remains Add Transaction so the most-common action is one tap away. Esc and outside-click dismiss the dial.
- **Global keyboard shortcuts** ([Layout.tsx](react/src/components/layout/Layout.tsx)). `n` / `g` / `b` / `d` / `a` (and uppercase variants) now open the matching add-modal from any page, not just Transactions. The existing typing-in-input guard still suppresses accidental triggers.
- **`useScrollDirection` hook** ([hooks.ts](react/src/hooks.ts)) — small RAF-throttled helper consumed by `AddFab`; available for future scroll-aware UI.
- **Bottom padding guard** — the main content area gained `pb-28 lg:pb-14` so the last list row is never hidden behind the FAB stack on mobile.

### Fixed
- **Number System dropdown couldn't be selected.** Picking "Indian — K / L / Cr" in Settings appeared to do nothing because [supabaseAdapter.updateProfile](react/src/lib/supabaseAdapter.ts) never mapped `numberSystem` to a column — the cloud round-trip returned `numberSystem: undefined`, the store merged `{ ...profile, ...next }`, and the just-picked value was overwritten. The `<select>` snapped back to **Western** instantly. New [numberSystemPref.ts](react/src/lib/numberSystemPref.ts) overlay persists the choice per-household in `localStorage` (key `vt_number_system_<householdId>`); [store.ts](react/src/store.ts) `refresh()` and `updateProfile()` now layer the overlay on top of the cloud profile, mirroring the documented "client-side overlay for un-migrated schema" pattern. No DB migration required; cross-device sync of the preference will arrive with a future schema bump.

### Notes
- `FloatingTools` (Planner / Ask Vyact) shifted to `bottom-[160px] lg:bottom-[88px]` so it stacks above the new `AddFab` without overlap.
- The page-scoped `n` shortcut on the Transactions page was removed since Layout now registers it app-wide; `/` (focus search) remains page-scoped.

---
## v7.4.3 — Transactions: slim filter bar, active chips, result-count + net *(2026-06-04)*

The Transactions page used to dedicate one full row to search and four full-width selects (Type / Category / Month / Member) on mobile — about 240px of vertical real estate before the first row even rendered. The bar now collapses to a single line on every screen size.

### Changed
- **Slim filter bar** ([Transactions.tsx](react/src/pages/Transactions.tsx)). Replaces the five-control row with: a single search input (inline `Search` icon, inline `X` to clear, `/` shortcut to focus) plus a `SlidersHorizontal` icon-button that opens a popover. The popover holds the four selects vertically and a **Reset** action.
- **Active filter count badge** on the filter button — a coral pip with the active-filter count so users see at a glance that filters are applied even when the popover is closed.
- **Active filter chip row** under the search bar — each non-default filter shows as a removable pill (`Type: expense ×`, `Category: Groceries ×`, etc.) with a **Clear all** link. One tap removes a single filter without re-opening the popover.
- **Result count + filtered net** under the chips — `42 transactions · Net −$1,284.50`. Sage when positive, terra when negative; hidden when the type filter is set to investments / transfers (where a signed net would be misleading).
- **Smarter empty state** — when the list is empty *with* filters active, the panel shows a focused "No transactions match your filters" message and a one-tap **Clear filters** button. When the list is empty with no filters, the message is the friendlier "add your first one" prompt instead of the generic "No transactions found".
- **Popover dismissal** — click-outside and Escape both close the filter popover so it never traps users on mobile.
- **`/` keyboard shortcut** to focus the search box (in addition to existing `n` / `N` for add). Honours the existing input-focus guard in `useShortcuts`.

No schema change, no new dependencies. Typecheck clean.

---
## v7.4.2 — Fix: sidebar auto-close, body-scroll lock, Help default-closed *(2026-06-04)*

### Fixed
- **Settings / Help links left the mobile sidebar open.** Every grouped nav item in [Sidebar.tsx](react/src/components/layout/Sidebar.tsx) called `onClose()` on click, but the footer `NavLink`s for Settings and Help skipped that handler — the drawer stayed up over the new page. Extracted a shared `closeOnMobile` helper and wired it to both footer links.
- **Background scrolled while the mobile sidebar was open.** When the user swiped inside the drawer's `<nav>` and the scroll hit a boundary, the gesture chained to the page underneath. Added `document.body.style.overflow = 'hidden'` for the lifetime of an open mobile drawer plus `overscroll-contain` on the inner nav.
- **Help page opened its first accordion by default.** Initial state changed from `useState<number | null>(0)` to `useState<number | null>(null)` so users land on a clean, fully collapsed list ([Help.tsx](react/src/pages/Help.tsx)).

No schema change, no new dependencies. Typecheck clean.

---
## v7.4.1 — Fix: forgot-password loop + iOS install banner *(2026-06-04)*

Two regressions from the v7.4.0 ship:

### Fixed
- **Forgot password was an infinite loop.** [SignIn.tsx](react/src/pages/auth/SignIn.tsx) linked to `/auth/reset` but [AuthGate.tsx](react/src/components/auth/AuthGate.tsx) only listed `/auth/reset-password` in `PUBLIC_ROUTES`, so unauthenticated users were redirected back to `/auth/sign-in?next=/auth/reset` — the page never loaded, so no reset email could be requested. Added `/auth/reset` to both `PUBLIC_ROUTES` and `RECOVERY_ROUTES` (both URLs render the same `ResetPassword` page), and pointed the SignIn link to the canonical `/auth/reset-password` so the redirect target matches the email link.
- **iOS install banner showed a non-functional Install button.** Only Android / desktop Chrome / Edge fire `beforeinstallprompt`; iOS Safari has never supported it and `prompt()` is unavailable. Banner now never renders the Install button on iOS and instead shows the Share → Add to Home Screen instruction. Also fixed two iOS detection gaps: (1) iPadOS 13+ reports `navigator.platform === 'MacIntel'` — we now check `maxTouchPoints` so iPads are recognised; (2) iOS Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS), DuckDuckGo, and common in-app browsers (FBAN/Instagram/Line/Twitter/LinkedIn) cannot install at all — they get a dedicated "Open in Safari to install" message instead of the share hint.

New helper: `isIosSafari()` in [pwa.ts](react/src/lib/pwa.ts) returns true only for real Safari on iOS / iPadOS.

No schema change, no new dependencies. Typecheck clean.

---
## v7.4.0 — Installable PWA: service worker, install banner, iOS support *(2026-06-04)*

Vyact is now installable to the home screen on Android, desktop Chrome / Edge, and (via Add to Home Screen) iOS Safari, and ships an opt-in service worker for offline-friendly shell loading and runtime asset caching.

### Added
- **Web App Manifest** (auto-generated by `vite-plugin-pwa`) with id `/`, scope `/`, `display: standalone` (display_override: window-controls-overlay → standalone → minimal-ui), Vyact theme `#E26D5C`, light bg `#FAF7F2`, portrait orientation, categories `finance / productivity / lifestyle`, and three jump-list shortcuts: **Add transaction** (`/transactions?add=1`), **Dashboard** (`/`), **Reports** (`/reports`).
- **Service worker** built by Workbox via `vite-plugin-pwa` — precaches the app shell, navigation fallback to `/index.html` (denylisted: `/api/*`, `/auth/*`, `version.json`), runtime caches for Google Fonts (StaleWhileRevalidate / CacheFirst) and Supabase REST (NetworkFirst, 4 s timeout, 24 h max-age). `skipWaiting: false` so the existing `UpdateBanner` stays in charge of the update UX.
- **`src/lib/pwa.ts`** — module that registers the SW (production only), captures `beforeinstallprompt`, and re-emits browser events as `vyact:installable` / `vyact:installed` / `vyact:sw-update` / `vyact:install-resolved` so React components stay decoupled from the lifecycle.
- **`InstallBanner`** (mounted at app root) — appears bottom-right when the browser fires `beforeinstallprompt`, calls `promptInstall()` from a single button, and on iOS Safari (no programmatic prompt) shows a "Share → Add to Home Screen" hint instead. Dismissible per-session and capped at three lifetime dismissals.
- **iOS PWA meta block** in `index.html`: `mobile-web-app-capable`, `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=default`, `apple-mobile-web-app-title=Vyact`, `apple-touch-icon` → `/favicon.svg`, `format-detection=telephone=no`, `application-name`, dual `theme-color` (light/dark), `color-scheme=light dark`, `viewport-fit=cover` for safe-area handling.

### Changed
- **`UpdateBanner`** now also reacts to a waiting service worker: when `vyact:sw-update` fires it offers Refresh, and the click calls `applyUpdate()` (skip-waiting + reload on `controlling`) instead of a plain `location.reload()`. Falls back to the existing `version.json` polling when no SW is installed.
- **`main.tsx`** wires `registerPwa()` after the React tree mounts. Dev is a no-op unless `devOptions.enabled` is flipped in `vite.config.ts`.
- Removed the legacy hand-written `public/manifest.webmanifest`; VitePWA emits the canonical one at the same path.

### Follow-ups
- Drop PNG icons (192, 512, 512-maskable) into `react/public/icons/` and re-add the entries to the manifest in `vite.config.ts`. Today the manifest references `favicon.svg` with `purpose: 'any maskable'` — Chrome and Edge accept SVG-only since 2022, but Android home-screen tiles and iOS look better with PNG.
- Consider an in-app "Install Vyact" tile in `Settings → Sync & Backup` that re-surfaces `promptInstall()` after the user has dismissed the banner.

---
## v7.3.2 — Cosmetic polish: dropdowns, row icons, money overflow, scroll UX *(2026-06-03)*



**Patch release.** Pure UI polish — no schema change, no store API change,
no new dependencies. Typecheck clean; production build clean.

**Dropdowns** — single canonical treatment app-wide. New `.ff-select` class
([index.css](react/src/index.css)) replaces the native browser arrow with an
inline-SVG chevron (12px right padding, 14px size, dark-theme variant) and
rounds the option list. Auto-applied through the shared `Select`
([Input.tsx](react/src/components/ui/Input.tsx)) so every modal Select picks
it up. The treatment is also inherited by every native `<select class="input">`
(Settings: Household, Date format, Language, Base currency, Number system,
Payoff strategy; Onboarding; Recurring filter) so Inter Tight selects in
Settings now look identical to the in-modal Splits-style ones.

**Row icon-action standard** — `.row-action` (32×32, transparent border,
danger variant goes coral-deep on hover) is now used everywhere a row needs
edit/delete/toggle controls. Recurring rows ([Recurring.tsx](react/src/pages/Recurring.tsx))
switched from `btn-ghost` text glyphs to Lucide `Pencil` / `ToggleLeft` /
`ToggleRight` / `Trash2`. NetWorth asset & liability rows ([NetWorth.tsx](react/src/pages/NetWorth.tsx))
followed the same pattern. (Budgets, Goals, Debts, TxnRow already migrated
in v7.4.0-prep work.)

**Settings → Sync & Backup** ([Settings.tsx](react/src/pages/Settings.tsx))
— emoji glyphs replaced with Lucide `Download` / `FileText` / `Clipboard` /
`ShieldAlert` / `Cloud`; CTA buttons re-shaped as `btn-secondary` tiles
with mono uppercase labels and tiny mono captions, matching the rest of
the app's button standard.

**Scroll UX** — new `ScrollToTop` component in [App.tsx](react/src/App.tsx)
listens to `useLocation().pathname` and resets `window.scrollTo(0, 0)` on
every route change so switching tabs doesn't carry the previous tab's
scroll depth.

**Mobile responsiveness — money overflow** — the adaptive `<Money>`
component ([Money.tsx](react/src/components/ui/Money.tsx)) now compacts
earlier on dense KPI tiles. Per-page tightening:
- [Card.tsx](react/src/components/ui/Card.tsx) value scales 1.4 → 1.7 →
  1.95 rem responsively; sub-line truncates.
- [Dashboard.tsx](react/src/pages/Dashboard.tsx) Total balance / Income /
  Expenses cards: `maxChars` 10 → 8.
- [Budgets.tsx](react/src/pages/Budgets.tsx) summary tiles: `grid-cols-3`
  → `grid-cols-1 sm:grid-cols-3` so they stack on phones; `maxChars`
  11 → 9.
- [Reports.tsx](react/src/pages/Reports.tsx) All-Time Income / Expenses /
  Net Flow / Avg Net cards: `maxChars` 10 → 8. Period Summary table and
  Money Map BreakoutTable cells now use `<Money maxChars={8}>` with
  `min-w-0`, so big amounts compact to K/M/B (or K/L/Cr) instead of
  overflowing the column.
- [Splits.tsx](react/src/pages/Splits.tsx) IOU summary tiles + per-split
  header total + participant share rows route through `<Money>`.
- [NetWorth.tsx](react/src/pages/NetWorth.tsx) Total Assets / Total
  Liabilities tiles + asset / liability / receivable rows route through
  `<Money>`.
- `min-w-0` propagated to flex containers so grid columns can actually
  shrink on phones.

**Row-level numeric typography** — `.num`
([index.css](react/src/index.css)) is redefined to use JetBrains Mono with
`tabular-nums` + `lining-nums`, so every row amount (Transactions, Splits,
Recurring, Budgets, Assets, Liabilities) reads in the same dense mono
treatment as the canonical Reports → Period Summary table. New
`.num-display` opt-out exists for hero callouts that need Inter Tight.

---
## v7.0.3 — Track-specific transaction modal *(2026-06-02)*

**One mental model per entry track.** The single "Add Transaction" modal that
previously asked Spend, Income, Transfer, and Investment to share one set of
fields is replaced (behind a feature flag) with a four-card track picker
followed by a track-tailored form. Implements the v7.1 roadmap item #1 (track
modal) plus item #9 (type-specific category lists), and unblocks the
calculator (#6) by giving it a single, predictable amount field per track.
**No backend migration** — the new `linkedToAssetId` rides on the existing
transaction `extras` JSON.

**Per-track field gating** ([TransactionFormModal.tsx](react/src/components/transactions/TransactionFormModal.tsx)):

| Field          | Spend | Income | Transfer | Investment |
|----------------|:-----:|:------:|:--------:|:----------:|
| Category list  | EXPENSE | INCOME | — (auto `transfer`) | INVESTMENT |
| From account   | ✅    | —      | ✅       | ✅         |
| To account     | —     | ✅     | ✅       | ✅         |
| Split          | ✅    | —      | —        | —          |

**New investment categories** ([constants.ts](react/src/constants.ts)):
`investment_in`, `investment_out`, `dividend`, `capital_gain`, `rebalance`.
Exposed via `CATEGORIES_BY_TYPE`; `getCat()` resolves them so existing
renderers Just Work. Legacy rows still pass through `ALL_CATEGORIES`.

**Transfer encoding (zero-backend)** ([store.ts](react/src/store.ts)). A
transfer entry expands inside `upsertTransaction` into two paired rows tagged
in `note` with `__tg:<groupId>`:
- Row A: `type: 'expense'`, source account, `category: 'transfer'`
- Row B: `type: 'income'`,  destination account, `category: 'transfer'`

`reportableTxns` ([calculations.ts](react/src/lib/calculations.ts)) now drops
`category === 'transfer'` so the pair self-cancels out of income/expense
totals. Deleting either half removes the other half — `removeTransaction`
reads the `__tg:` tag and cascades.

**TrackPicker** ([components/transactions/TrackPicker.tsx](react/src/components/transactions/TrackPicker.tsx)) — four-card picker, keys
`1`/`2`/`3`/`4` jump straight to a track, `Esc` cancels. Edit mode skips the
picker — track is locked to the row's stored `type`.

**Account dropdown plumbing** ([lib/accounts.ts](react/src/lib/accounts.ts)).
`buildAccounts` now accepts `{ excludeId, filter }` so the destination
dropdown excludes the source account and a user can't transfer to the same
place they came from.

**Feature flag.** Off by default in v7.0.3 for dogfood; the legacy single
`<Type>` `<Select>` is the production code path until we flip the flag.
Enable via `localStorage.setItem('vt_feature_track_picker', '1')`. New
helper [lib/featureFlags.ts](react/src/lib/featureFlags.ts) gates this and
future flags.

**Type extension** ([types.ts](react/src/types.ts)). `Transaction` gains an
optional `linkedToAssetId` — destination account / investment vehicle for
the transfer + investment tracks. Persists through `txnToRow` /
`rowToTxn` ([supabaseAdapter.ts](react/src/lib/supabaseAdapter.ts)).

Verification: `npx tsc --noEmit` clean; consumer build succeeds; no schema
change.

### v7.0.3 — Punch-list polish *(2026-06-02)*

Closing the four spec-compliance gaps surfaced after the initial v7.0.3 ship
([SOLUTION_TRACK_TXN_MODAL.md](docs/SOLUTION_TRACK_TXN_MODAL.md) field map):

- **Income account is a "To account"** — for `type === 'income'` the single
  account select is now labelled *To account* (the deposit destination)
  instead of the unified *Account* label, matching the spec's per-track
  field map.
- **Description is optional for transfers** — transfers self-describe via
  the source/destination pair; the validator now skips the description
  requirement when `isTransfer`. Placeholder also changed.
- **Member is optional for transfers** — same rationale; transfers belong
  to the household, not a person.
- **Last-used track memory** — the picker now remembers the user's last
  pick per household (`vt_last_track_<hid>` in localStorage) and pre-skips
  the picker into that track on the next add. The *Change* affordance
  remains visible so they can hop back to the picker in one click.
  Persistence is best-effort; quota errors are silently ignored.

Verification: TypeScript clean on all touched files
([TransactionFormModal.tsx](react/src/components/transactions/TransactionFormModal.tsx)).

---
## v7.3.1 — Patch release: version alignment & UI polish *(2026-06-03)*

**Small increment, no schema change.** This patch advances the consumer line by
one step so the package metadata, built `version.json`, and release documents all
agree on the shipped branch.

- Aligns the consumer runtime stamp to `7.3.1` so version surfaces no longer
  report the stale `7.0.x` branch while the changelog advertises `v7.3.x`.
- Records the small UI work already shipped in this patch window: text-based
  transaction time entry, Settings-only placement for sensitive export/reset
  actions, and sidebar label cleanup for Accounts / Insights.

Verification: TypeScript clean (`npm.cmd --prefix react run typecheck`).

---
## v7.3.0 — Saved Views, Account Drawer & Education progress *(2026-06-03)*

**The v7.3 trio.** Three Money Map epics that v7.2.0-rc deferred all land
together: cross-device **Saved Views** (Item #4), the **multi-account
split drawer** on Track (Item #5, the biggest remaining UI lift), and
**education progress sync** behind the new WhyChip primitive (Item #7
prep). Reports also flips its breakout read path onto the pre-aggregated
`v_txn_by_*` cloud views when Money Map is `'on'`, with a transparent
fall-back to client-side fold for shadow / off / local builds (Item #8
second half).

### Database

- `20260602140000_money_map_saved_views.sql` — `saved_views` table with
  `(user_id, household_id, page, name)` uniqueness, RLS that scopes
  reads to "owner OR (member of household AND `is_shared`)", writes to
  owner-only, and a `replace_saved_views(h, rows)` RPC following the
  TD-09 pattern. Sharing is opt-in per row via `is_shared`.
- `20260602130000_money_map_education_progress.sql` (already in tree)
  surfaces a `profiles.education_progress jsonb` column. v7.3.0 wires it
  end-to-end through `getProfile` / `updateProfile` and the new
  `markEducation` action.

### Adapter

- `DataAdapter.Entity` extended with `'savedViews'`. `supabaseAdapter`
  gets a `tableName(entity)` helper (replaces inline ternaries),
  `savedViewToRow` / `rowToSavedView` mappers, and a
  `replace_saved_views` branch on `replaceAll`.
- New `queryTxnByMember(hid)` and `queryTxnByAccount(hid)` adapter
  methods that read from the pre-aggregated SQL views; both return
  `undefined` from `HybridAdapter` when the cloud is unavailable so
  callers can fall back to a client-side fold without an `if (cloud)`
  branch.

### App

- `components/savedViews/SavedViewsBar.tsx` — generic save / apply /
  manage bar wired into `Transactions`, `Reports`, and `Insights`.
  Strips private filter keys (`search`, `description`, `memberId`,
  `memberIds`, `txnId`, `transactionId`) before persisting; surfaces a
  privacy disclaimer next to the **Share with household** checkbox.
  Hidden entirely on local-only builds.
- `components/transactions/AccountDrawer.tsx` — collapsible multi-row
  drawer that splits a single transaction across two or more accounts.
  Shows a running sum, a balanced / out-of-balance indicator (±0.01),
  an **Apply remaining** action, and a **Remove** affordance per row.
  Wired into `TransactionFormModal` for non-transfer txns when the
  household has more than one account; persists onto
  `transactions.extras.accountSplits` (table-level migration deferred to
  v7.4 alongside the `splits` table reshape).
- `components/education/WhyChip.tsx` + `lib/educationProgress.ts` —
  `markEducation(topicId, patch)` writes to the cloud profile when
  signed in and to a 50-key LRU `localStorage` map otherwise.
  `WhyChip` auto-marks `completed_at` on open and `dismissed_at` on
  close.
- `pages/Reports.tsx` — when `getMoneyMapMode() === 'on'`, hydrates
  member / account breakouts from `queryTxnByMember` / `queryTxnByAccount`
  and folds them with the existing currency-conversion math; otherwise
  falls back to the v7.2.0-rc client-side reduction over
  `reportableTxns(txns)`. Same UI shape, mobile-friendly payload.

### Notes

- Education progress is **not** considered PII. The column is read /
  written by the existing `profiles` RLS — owner-only.
- Saved Views sharing reuses the existing household-membership policy;
  no new RLS surface area.
- Account split rows live on `extras` deliberately so v7.2.x clients
  reading the same row keep working. The dedicated `transaction_splits`
  table is queued for v7.4.

---


**Default everyone into shadow mode.** v7.1.x landed the Money Map plumbing
(accounts FK, dual-write, account drawer); v7.2.0-rc flips the mode default
so cloud builds opt themselves into shadow writes without a manual
localStorage flag. Adds the last three product surfaces called out in
[`docs/SOLUTION_MONEY_MAP.md`](docs/SOLUTION_MONEY_MAP.md) — debt direction,
receivables on Net Worth, and member/account breakouts on Reports — and
ships the missing `replace_accounts` RPC that lets `HybridAdapter` push
account snapshots back to Supabase.

This is **release-candidate**: the data path is live, but the mode stays
`'shadow'` (legacy reads, dual writes) until v7.2.1 promotes it to `'on'`.

### What's new

1. **`replace_accounts` RPC.** New migration
   [`20260602130000_money_map_replace_accounts_rpc.sql`](supabase/migrations/20260602130000_money_map_replace_accounts_rpc.sql)
   adds the bulk-replace SECURITY DEFINER function that
   [`HybridAdapter.replaceAll('accounts', …)`](react/src/lib/hybridAdapter.ts)
   already calls. Same shape as the other `replace_*` RPCs (TD-09): guarded
   by `is_member(h)`, soft-deletes by household, re-inserts from
   `jsonb_populate_recordset`. Execute revoked from public/anon, granted
   only to authenticated.

2. **Cloud-aware feature-flag default.**
   [`getMoneyMapMode()`](react/src/lib/featureFlags.ts) now returns
   `'shadow'` automatically when `VITE_SUPABASE_URL` is set and the user
   hasn't pinned a value in localStorage. Local-only builds still default
   to `'off'`. Explicit localStorage values continue to win — `'off'`,
   `'shadow'`, `'on'`/`'1'`/`'true'`/`'yes'` are all honoured.

3. **Debt direction tabs.** [`Debts`](react/src/pages/Debts.tsx) gains an
   `All / Owe / Owed to me` segmented control when the flag is on, plus a
   `totalReceivables(...)` summary chip on the Owed-to-me tab. Filter
   short-circuits to the legacy single list when the flag is off, so v7.1
   households see no UI change.
   [`totalLiabilities`](react/src/lib/calculations.ts) and
   `totalMonthlyDebtPayment` now exclude `direction === 'owed_to_me'` rows
   so receivables stop inflating debt-load and DTI.

4. **Net Worth shows receivables separately.**
   [`NetWorth`](react/src/pages/NetWorth.tsx) renders the formula as
   `Assets + Owed to me − Liabilities` whenever receivables are non-zero,
   and the Liabilities column splits into the existing "I owe" list plus a
   small "Owed to me" sub-list with denim accents. Single-currency
   formatting is unchanged when no receivables exist (back-compat).

5. **Reports — By member / By account.**
   [`Reports`](react/src/pages/Reports.tsx) gains two flag-gated panels at
   the bottom of the page that aggregate `reportableTxns(txns)` locally by
   `t.initiatedBy || t.memberId` and `t.accountId || t.linkedAssetId`,
   resolving names against `useStore(s => s.members)` and
   `useStore(s => s.accounts)`. Cloud-side `v_txn_by_*` views remain a
   future read-path optimisation; the local fold is the correctness
   baseline.

### Deferred to v7.2.x / v7.3

- **Account drawer M-tier** — multi-account split UI for transactions
  still pending (DEBT-FC-010 / NWRT-FC-007 deferred).
- **Saved views** — separate slice tracked in
  [`docs/SOLUTION_REPORTS_VARIANTS.md`](docs/SOLUTION_REPORTS_VARIANTS.md);
  schema + entity slice land in v7.3.
- **Flag retirement** — `getMoneyMapMode()` flips its default to `'on'` in
  v7.2.1 once the shadow-mode dashboards confirm parity.

Verification: TypeScript clean
(`react/node_modules/.bin/tsc --noEmit` → exit 0).

---
## v7.1.3 — Accounts management UI *(2026-06-02)*

**Closes the v7.1.2 follow-up.** Now that `accounts` is wired through the
adapter and store, this release surfaces it to the user: a flag-gated
**Accounts** page lists every account, lets the operator add / rename /
mark-default / archive / restore, and shows backfill provenance (which
asset or credit card the row was minted from).

**Net new files**:
- [`AccountFormModal.tsx`](react/src/components/accounts/AccountFormModal.tsx) — kind / name / currency / default / archived. Mirrors `AssetFormModal` so the contract is familiar. Preserves `assetId` on edit so backfill links survive renames; threads `updated_at` for optimistic concurrency.
- [`pages/Accounts.tsx`](react/src/pages/Accounts.tsx) — alphabetised active list, collapsible **Archived** section, default chip, edit pencil, archive / restore button, link caption when the row is bound to an asset or debt. Renders an empty-state when `money_map` is `'off'`, and a shadow-mode caption when it is `'shadow'`.

**Wiring**:
- [App.tsx](react/src/App.tsx) — lazy-loaded route `/accounts` plus a `<RootModals>` slot for the form modal.
- [Sidebar.tsx](react/src/components/layout/Sidebar.tsx) — new PLAN-group entry (CreditCard icon) added to the visible set **only when `getMoneyMapMode() !== 'off'`**, so households on the default flag see no extra clutter.

**Out of scope (deferred):** the `replace_accounts` RPC for bulk import, and
hard-delete UI. Archive is a soft toggle (`isArchived`) and the picker in
`buildAccountsFromStore` already filters archived rows.

Verification: `tsc --noEmit` exit 0; `get_errors` clean on
[App.tsx](react/src/App.tsx),
[Sidebar.tsx](react/src/components/layout/Sidebar.tsx),
[store.ts](react/src/store.ts),
[AccountFormModal.tsx](react/src/components/accounts/AccountFormModal.tsx),
[Accounts.tsx](react/src/pages/Accounts.tsx).

**Next:** v7.2 — `savedViews` migration + entity slice (Reports / Transactions
filter persistence per the Money Map plan).

---
## v7.1.0-rc — Money Map foundation *(2026-06-02)*

**Schema-only release. App still runs on the legacy code paths.** First step
of the Money Map rollout from [SOLUTION_MONEY_MAP.md](docs/SOLUTION_MONEY_MAP.md):
ships the additive Postgres schema + types + feature-flag plumbing so the
app surface can land in v7.1.1 without a co-deploy of SQL and TypeScript.

**New migrations** (apply in order; each is idempotent and additive-only):

1. [20260602120000_money_map_phase1_accounts.sql](supabase/migrations/20260602120000_money_map_phase1_accounts.sql)
   — `accounts` table, `transactions.{account_id, to_account_id, initiated_by}`
   FKs, `debts.{direction, counterparty_name}`, server-side `v_txn_by_member`
   and `v_txn_by_account` views, and RLS that mirrors the existing
   transactions policy shape via the TD-21 `is_member` / `role_in` helpers.
2. [20260602120100_money_map_phase1_backfill.sql](supabase/migrations/20260602120100_money_map_phase1_backfill.sql)
   — synthesises one `accounts` row per spendable asset (checking, savings,
   credit_card, cash) per household, picks the largest-balance account as
   `is_default` per currency, and links every existing transaction's
   `account_id` / `to_account_id` from the v7.0.3 `extras.linkedAssetId` /
   `extras.linkedToAssetId` keys. Rerunnable; does **not** touch rows
   already pointing at an account.
3. [20260602120200_money_map_education_progress.sql](supabase/migrations/20260602120200_money_map_education_progress.sql)
   — additive `profiles.education_progress jsonb` for cross-device tip
   sync (Item #7).

**No DROPs, no column renames, no data destruction.** Existing
`transactions.member_id`, `assets.*`, and the v7.0.3 `extras.linkedAssetId`
JSON value all remain authoritative until the v7.1.1 dual-write window
flips on.

**App-side scaffolding (no behaviour change yet):**
- [types.ts](react/src/types.ts) — `Transaction.{accountId, toAccountId,
  initiatedBy}`; `Debt.{direction, counterpartyName}`; new `Account`,
  `AccountKind`, `SavedView`, `SavedViewPage` interfaces. Optional fields
  only — every existing serialised row deserialises unchanged.
- [featureFlags.ts](react/src/lib/featureFlags.ts) — new `'money_map'`
  flag with three states (`'off'` | `'shadow'` | `'on'`) via a dedicated
  `getMoneyMapMode()` reader. Defaults to `'off'`; production code paths
  are unchanged until the flag is flipped per-tenant or globally.

**Pre-flight checklist for applying the SQL** (per the spec's gate list):

1. Supabase Dashboard → Database → Backups: take a manual snapshot or run
   `pg_dump` to off-Supabase storage. Restore against staging to verify.
2. Apply migration `20260602120000` first; confirm `accounts` table is
   created and the RLS policies appear under Authentication → Policies.
3. Apply migration `20260602120100` (backfill). Run twice — row counts
   must match (acceptance gate #3 in the spec).
4. Apply migration `20260602120200` (education progress).
5. Verify `select count(*) from accounts;` matches the count of spendable
   assets across all households. Spot-check `select * from transactions
   where account_id is null and extras->>'linkedAssetId' is not null;`
   — should return 0 rows after backfill.
6. Leave `vt_feature_money_map` unset (= `'off'`). The app continues to
   read/write the legacy paths. **No user-visible change in v7.1.0-rc.**

**Next (v7.1.1):** dual-write window — adapter writes both `account_id`
*and* `extras.linkedAssetId`; reads prefer `account_id` with legacy
fallback. Cross-version Playwright suite added.

---
## v7.1.1 — Money Map dual-write (cloud adapter) *(2026-06-02)*

The Money Map schema is in. v7.1.1 wires the cloud adapter to **read the
new FK columns and dual-write them alongside the legacy `extras` JSON**.
Behaviour is unchanged for users until the v7.1 UI surfaces Accounts /
Lending — but every cloud row that v7.1.1 writes is now consumable by
both v7.0.3 (legacy `extras.linkedAssetId`) and v7.2+ clients
(real `account_id` FK).

**[supabaseAdapter.ts](react/src/lib/supabaseAdapter.ts)** changes:

- `TransactionRow` typedef gains `account_id`, `to_account_id`,
  `initiated_by` (all optional, since legacy rows arrive without them).
- `txnToRow` writes `account_id ← accountId ?? linkedAssetId`,
  `to_account_id ← toAccountId ?? linkedToAssetId`,
  `initiated_by ← initiatedBy ?? memberId`. The legacy `extras.linkedAssetId`
  / `linkedToAssetId` keys are still written so a v7.0.3 client reading
  the same row sees the data it expects (dual-encoding contract from
  [SOLUTION_MONEY_MAP.md](docs/SOLUTION_MONEY_MAP.md) Risk A-1 / A-2).
- `rowToTxn` prefers `account_id` and falls back to `extras.linkedAssetId`
  for rows authored by an older client. Same for the destination side.
- `DebtRow` gains `direction`, `counterparty_name`. `debtToRow` defaults
  `direction` to `'owed_by_me'` to preserve the legacy semantic; `rowToDebt`
  reads it back the same way. No change for any debt that doesn't opt in.

**No store, page, or modal changes in this slice.** `lib/accounts.ts` still
synthesises from assets; the `accounts` table is populated server-side
but the client doesn't read it yet. That's v7.1.2 — by isolating the
adapter cutover, a regression in dual-write surfaces here without
touching any UI surface.

**Verification path:**
1. Apply the v7.1.0-rc migrations (already done — schema is live).
2. Deploy v7.1.1; observe `transactions.account_id` populating on every
   new write. SQL spot-check:
   ```sql
   select count(*) filter (where account_id is null) as legacy_only,
          count(*) filter (where account_id is not null) as dual_written
     from transactions
    where created_at >= now() - interval '1 hour';
   ```
3. Open the same household in a v7.0.3 build (e.g. an iOS PWA pinned
   to the previous version). The transaction's source / destination
   account chip must still render correctly — proves the legacy
   `extras` keys remain intact.

**Next (v7.1.2):** ship `accounts` CRUD through the adapter + store; add
the `Accounts` page; switch `lib/accounts.ts` to read the table when
`getMoneyMapMode() !== 'off'`. Nothing user-visible until v7.2 ships
Variant A or B of Item #2 from the spec.

---
## v7.1.2 — Accounts as a first-class entity *(2026-06-02)*

The Phase 1 backfill writes one `accounts` row per spendable asset, but
v7.1.1 didn't read them — the picker still re-derived options from
`assets + debts` every render. v7.1.2 makes `accounts` a normal
`DataAdapter` entity (alongside transactions, budgets, goals, debts,
assets, members) and lets the transaction modal source from the cloud
table when the Money Map flag is on. **Still nothing user-visible** with
the flag at default `'off'` — this slice is the wiring, not the surface.

**[dataAdapter.ts](react/src/lib/dataAdapter.ts)** — `Entity` union gains
`'accounts'`; `TypedListers` gains `listAccounts`; the per-household
delete cleans up the `accounts` bucket alongside the others.

**[supabaseAdapter.ts](react/src/lib/supabaseAdapter.ts)** — adds
`AccountRow` (mirrors the
[Phase 1 migration](supabase/migrations/20260602120000_money_map_phase1_accounts.sql)
columns), `accountToRow` / `rowToAccount` mappers, and routes them
through `list()`, `upsert()`, and `mapRowBack()`. The generic CRUD path
already handles the `accounts` table name — no special-case needed
unlike `members → memberships`. `replaceAll` for `accounts` would call
the (non-existent) `replace_accounts` RPC; not wired because nothing
calls it yet, but explicitly out of scope for this slice.

**[store.ts](react/src/store.ts)** — new `accounts: Account[]` slot,
hydrated alongside the other entities in `refresh()`, included in the
empty-state and sign-out reset. The cache no-clobber guard treats it as
a normal entity (per-`(household, entity)` sentinel via the existing
HybridAdapter machinery — no changes needed there).

**[accounts.ts](react/src/lib/accounts.ts)** — adds
`buildAccountsFromStore(accounts)` that reads the canonical table
directly. Encodes the picker `value` in the same `cash` / `asset:<id>`
/ `debt:<id>` scheme as the legacy `buildAccounts(assets, debts)`,
keyed by `account.assetId` so the FK on a transaction written by either
the legacy path or the v7.1.1 dual-write resolves to the same picker
chip. Falls back to `account.id` for accounts a future Accounts page
creates without an `assetId` link.

**[TransactionFormModal.tsx](react/src/components/transactions/TransactionFormModal.tsx)**
— picker derivation flips on `getMoneyMapMode() !== 'off' && accounts.length > 0`.
With the flag off (default everywhere today) the legacy assets+debts
derivation runs unchanged. With the flag on but no accounts in the
store (a household that hasn't run the backfill, or local-only mode)
the same legacy fallback applies — no empty pickers.

**Out of scope for v7.1.2** (carried to v7.1.3 / v7.2):
- No Accounts CRUD page yet — accounts are read-only from the user's POV
  and only mutate via the Phase 1 backfill.
- No `savedViews` entity — no migration ships the table yet, so wiring
  the adapter would have nothing to talk to.
- No cross-version Playwright suite — deferred until the Accounts page
  surfaces a picker the test can drive.

**Verification path:**
1. Apply Phase 1 migrations (already live in production).
2. Deploy v7.1.2 with `vt_feature_money_map = 'off'` (default). Confirm
   the existing transaction picker continues to render the same options
   as before (pre-merge regression check).
3. Flip `localStorage['vt_feature_money_map'] = 'shadow'` in a single
   browser. Open Add Transaction → confirm picker still renders, with
   `account.name` for the Net Worth banks/cards (the labels source from
   the canonical table now, but should match what the legacy code
   computed).
4. SQL: `select count(*) from accounts where household_id = '<hid>';`
   should be `≥ 1` for any cloud household; if zero, the picker still
   falls back to legacy mode and the modal works regardless.

**Next (v7.1.3 / v7.2):** Accounts management page — list, create,
rename, archive — and the `replace_accounts` RPC if/when bulk import
needs it. After that, the `savedViews` migration + entity slice.



**Dashboard no longer blank on first post-login render.**
`HybridAdapter.list()` previously returned the (empty) cache immediately and
fired the cloud fetch in the background — on a fresh device the dashboard
mounted against `[]` and only filled in after a manual refresh. The adapter
now detects a *cold start* per `(household, entity)` — no delta cursor, empty
cache, and no `cloud_synced_<hid>_<entity>` sentinel — and `await`s the first
cloud `list()` before resolving. Returning users keep the snappy
stale-while-revalidate path (cached rows return instantly, cloud refresh
continues in the background). Cache no-clobber rule (v6.4) is preserved.

**Recent Activity feed is now concrete, not high-level.** Lines used to read
"INSERT on transactions". They now read "Maya logged Groceries · $84.20" with
column-level diffs on UPDATE rows ("amount: $50.00 → $65.00 · note: …"), a
relative timestamp with absolute tooltip, an entity-tinted left border, and a
Lucide icon per entity type.
- New `src/lib/activityFormat.ts` — pure formatter that resolves actor names
  from members + profile, builds an entity-specific subject line
  (transactions / budgets / goals / debts / assets / memberships / invitations),
  and emits up to two changed-field diffs (`+N more` beyond that). Reads both
  snake_case (`current_balance`, `display_name`) and camelCase shapes so it
  works against raw `activity_log.changes` jsonb.
- New `src/components/households/ActivityRow.tsx` — presentational row with
  border-tone + icon + tabular diff line.
- `pages/Households.tsx` — old inline panel replaced with an `ActivityPanel`
  subcomponent. Filter pills (All / Money / Plans / Debts / Net worth /
  People), an actor dropdown when the household has more than one member,
  fetch limit raised from 30 → 100, and a "Show all N entries" reveal after
  the first 25.

**Legacy localStorage write-back removed.** The `vt_` key namespace is now the
only write target. `localStorageCompat.ts` still reads legacy `ff_` keys as a
fallback, but any new save rewrites state only under `vt_` and removes the old
legacy slot for that key.

**Source comment cleanup.** Remaining `// FinFlow ...` source-file header
comments in `react/src/` were renamed to `// Vyact ...` to finish the in-code
branding pass without touching historical changelog or roadmap entries.

**Operations runbook added.** New root `OPERATIONS.md` documents the repo's
actual migration, backup, staging-restore, and deploy verification flow.

Verification: `npx tsc --noEmit` clean; consumer build succeeds; no schema change.

## v7.0.1 — Archive vanilla shell + Google button (coming soon) *(2026-06-01)*

**Vanilla shell archived.** Removed `index.html`, `app.js`, `style.css`,
`src/dataAdapter.js`, `setup.sh`, `vercel-setup.sh`, `QUICKFIX.md`,
`DEPLOYMENT.md`, and `Stubs.tsx` from the working tree. All pages are ported to
the React app; `vercel.json` has always built from `react/` only. Source
preserved in git history.

**Google sign-in button — "Coming soon".** Button is now always visible and
positioned as the primary CTA on Sign In and Sign Up (above the email form).
Clicking it shows a toast: *"Google sign-in coming soon — use email for now."*
No OAuth flow is triggered. Will be activated once the Supabase Google provider
+ redirect URLs are configured (tracked in `docs/handoff-plans/todo.yaml` as
`google_sso_provider_config` — human step).

## v7.0.0 — Rebrand: FinFlow → Vyact *(2026-06-01)*

First release under the Vyact brand. Product rename from FinFlow to Vyact across
the entire consumer app. All core functionality is unchanged; this release is
exclusively a brand migration.

**What changed:**
- Product name, titles, meta tags, OG/Twitter cards, PWA manifest, and all
  in-app UI copy updated from "FinFlow" to "Vyact".
- `localStorage` key migration: new `vt_` prefix replaces legacy `ff_` prefix
  with a transparent compatibility shim (`localStorageCompat.ts`). Existing user
  data is preserved automatically — the shim reads `ff_*` keys on every get and
  writes both `vt_*` (primary) and `ff_*` (legacy compat) on every set, giving a
  90-day safety window before hard-cutting the old keys.
- Export filenames: `finflow-backup-*.json` → `vyact-backup-*.json`,
  `finflow-transactions-*.csv` → `vyact-transactions-*.csv`.
- `VITE_APP_URL` → `https://vyact-twentyx.vercel.app` (consumer) /
  `https://vyact-admin.vercel.app` (admin).
- `X-Client-Info` header → `vyact/v7.0.0`.
- `FinFlow App/` legacy spec folder removed from repo.
- Repo renamed to `Vyact` on GitHub.
- `CLAUDE.md`, `VERSIONS.md`, `DEPLOY.md`, `HANDOFF.md` updated.
- `deploy.yml` deploy-comment updated to reference `vyact-twentyx.vercel.app`.

**What was NOT changed (intentionally):**
- Historical entries in `VERSIONS.md` are preserved as-is (brand evolution is
  part of the company story; we add a new entry, we do not rewrite history).
- Code-level `// FinFlow` comments in source files are cosmetic only (they carry
  version history context) — being cleaned up progressively in subsequent PRs.
- Supabase project ID unchanged (`dmxqkvploojokffuhxnz`).
- No schema changes; no migration required.

Build: `npm run lint` clean; `npm run build` succeeds; `dist/version.json` → `7.0.0`.

## v6.6.0 — Earnable Pulse Score + Google sign-in + reset-without-email *(2026-05-30)*

Three user-facing features from the solutioning epic (`docs/handoff-plans/`),
implemented locally by a junior against the line-level brief
(`docs/handoff-plans/JUNIOR_BRIEF_wave_safe.md`) and finalised in lead review.

- **Pulse Score is now real and earnable (plan 09).** `computePulseScore` no
  longer hands out arbitrary defaults (the old `budget=60 / goals=60 / trend=70 /
  debt=100` that pinned every empty account at ~55). Each of the 5 components is
  scored **only when it has data**; the remaining weights are **renormalised**,
  so the number reflects what the household can actually act on. A data-less
  account now returns `total: null` and the gauge shows **"— / No data yet"**
  with a "Building your Pulse — add income and a budget to begin" prompt instead
  of a misleading score. Debt-free is *excluded* (not gifted 100). `PulseGauge`
  shows "—" for not-yet-applicable components and respects
  `prefers-reduced-motion`. `pulseStatus(null)` added.
- **Continue with Google (plan 11).** New `GoogleButton` (gated on
  `isCloudEnabled`, so it never renders in local-only mode) wired into Sign In,
  Sign Up, and the password-reset page. Uses the pre-existing
  `signInOAuth('google')` helper. **Requires the Supabase Google provider +
  redirect URLs to be configured before it functions** — that dashboard step is
  tracked in plan 11 and is not part of this code release.
- **Password reset no longer dead-ends without email (plan 07).** The reset page
  now offers Google + magic-link fallbacks and a no-cloud guidance state, so a
  user who never receives a reset email can still regain access. The existing
  email recovery-link flow is unchanged.
- **AI summary type-safety (review catch).** `aiSummary.ts` also consumed
  `pulseScore.total`; it now accepts `number | null` and coerces to `0` for the
  stub agent (flagged by the junior via a `TODO(review)` — confirmed acceptable
  for the stub; revisit when the v8 chat backend lands).

Verification: `npm run lint` clean (0 errors); `npm run build` succeeds;
schema gate unchanged (no SQL in this release). The plan-10 recurring
unification migration is **not** in this release — it ships separately as a
review-gated DB change.

## v6.5.1 — In-app "new version available" update prompt *(2026-05-30)*

Fixes the "users keep seeing an old build after a deploy" problem (the cause
of the v6.4.27 → v6.5.0 footer-stuck confusion). The app has **no service
worker**; hashed assets are `immutable`-cached and a long-lived tab never
learns a newer build shipped.

- **Build stamps `dist/version.json`** with `package.json`'s version (new
  vite plugin in `vite.config.ts`).
- **`UpdateBanner`** (mounted at App root) polls `/version.json` with
  `cache: 'no-store'` on load, on tab focus/visibility, and every 15 min. When
  the deployed version differs from the running `__APP_VERSION__`, it shows a
  dismissible banner with a **Refresh** action. Degrades to a no-op in dev and
  on any fetch error.
- No change to data, money math, or existing UI; purely additive.

## v6.5.0 — E2E test automation foundation (Batch 1+2) + test-build cloud-leak fix *(2026-05-30)*

**Non-functional release.** No change to runtime app behaviour or UI — this is a
version marker for the QA-automation milestone plus one build-guard fix.

- **Playwright E2E suite landed and green** — 20 passed / 3 skipped on chromium.
  Covers §1 Transaction Creation (7), §5 Budgets (6), §7 Debt payment math (1),
  plus the foundation/smoke set. Page Objects (`TransactionFormModal`,
  `BudgetFormModal`, `BudgetsPage`, `NetWorthPage`, …), deterministic fixtures
  (frozen clock, pinned UUID, `seedWith`), and the test-case inventory
  (`react/e2e/TEST_CASE_INVENTORY.md`, now 20/163 developed) are the source of
  truth for functional QA. The 3 skips are honest `fixme`s gated on
  Auto-Linking Phase A (NWRT-FC-002), transfer UX (TXN-FC-003), and the
  budget-threshold notification engine (BDGT-FC-003).
- **Accessibility groundwork (also enables stable test locators):** `Modal`
  now renders `role="dialog"` + `aria-modal` + `aria-labelledby`; `Field`
  associates its `<label>` with the control via `htmlFor`/`id`. Pure a11y
  addition — no visual change.
- **Build fix — `lib/supabase.ts`:** the production `FALLBACK_URL/KEY` (added
  in v6.4.27 to keep prod always DB-connected) was being applied on *any*
  prod-style build, including the e2e `vite build --mode test` build — which
  silently flipped the test app into cloud mode and gated every route behind
  `/auth/sign-in`. The fallback is now skipped when
  `import.meta.env.MODE === 'test'`. **Real production (`MODE === 'production'`)
  is unchanged** — the deployed app still gets the fallback creds.

## v6.4.27 — Production DB-connection fix + deploy hardening + in-app version note *(2026-05-30)*

Fixes a production defect where the live consumer showed **dummy / seeded data with no real auth** — it had silently shipped in localStorage-only mode.

**Root cause.** The CI build never received `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, so `src/lib/supabase.ts` fell back to local-only mode. The Vercel consumer project lacked the env vars and `deploy.yml` injected them from GitHub secrets that were empty — and because **Vite gives shell env vars higher precedence than `.env` files**, the empty secret silently overrode everything. (Verified: the live main JS chunk contained zero occurrences of the Supabase project ref.)

**Fix — self-contained, deterministic config.**
- Committed `react/.env.production` (and `admin/.env.production`) with the **public** project URL + **publishable** key (`sb_publishable_…`). These are public client values by design — they already ship in the browser bundle, and Row-Level Security enforces access server-side. The `service_role`/secret key is never included.
- Removed the `VITE_SUPABASE_*` / `VITE_APP_URL` injection from the `deploy.yml` build steps so the committed `.env.production` is authoritative and a missing/empty secret can never override it again.
- **Definitive belt-and-braces fix:** `src/lib/supabase.ts` (and the admin client) now fall back to the public URL + publishable key **in production builds** (`import.meta.env.PROD`) when the env var is missing/empty. This is required because `vercel pull` writes an empty `.env.local` that Vite ranks *above* `.env.production`, so the committed file alone was still overridden on Vercel. With the PROD fallback, a build with **no env files at all** still embeds the project ref → the deployed app is always DB-connected. Local `npm run dev` stays local-only (fallback is PROD-gated) unless you provide `.env.local`.
- Validated: a CI-equivalent build (no `.env.local`, no `.env.production`) embeds the Supabase project ref → connects to the real database.

**Deploy hardening (process).** Documented the authoritative deploy flow in `DEPLOY.md`: every push to `main` runs `deploy.yml`; `db-migrations` is best-effort (`continue-on-error`) and the `consumer`/`admin` jobs run with `if: always()`, so a Supabase-auth hiccup never blocks a frontend release. Corrected the documented live URLs to the real Vercel production domains (`vyact-twentyx.vercel.app` / `vyact-admin.vercel.app`); flagged the orphaned `react-taupe-xi` / `finflow-admin` URLs.

**In-app version note.** The current app version (from `package.json`, inlined at build time via a Vite `define` as `__APP_VERSION__`) now shows as a small sub-note at the bottom of the **Help & Guide** page.

No consumer feature/behaviour change beyond reconnecting the database and the Help footer note.

## v6.4.26 — Money typography standardisation: one canonical figure style across all sections *(2026-05-29)*

Design-system consistency pass on how monetary/numeric values are rendered. Before this, the same "price" concept appeared in **four** different treatments depending on the screen — italic Newsreader serif (Dashboard KPI tiles, Net Worth hero, donut-chart centre, Dashboard mini balance-sheet), plain non-tabular sans (Splits totals & shares), JetBrains Mono (Transaction row amounts inherited a mono parent; Dashboard balance-sheet rows; Reports), and the tabular-sans `<Money>` component (Budgets, Goals). The mixed italic/serif/mono/sans figures read inconsistently, increased cognitive load, and risked overflow on mobile.

**One canonical treatment.** New `.num` design-system class (`react/src/index.css`): **non-italic** Inter Tight with `tabular-nums` + `lining-nums` and tightened tracking. Every amount across Dashboard, Budgets, Splits, Transactions, Net Worth, Debts and Reports now uses it, so figures read identically everywhere, digits stay column-aligned (no reflow as values change), and the same class scales from a 0.8 rem row to a 3 rem hero without breaking mobile real-estate.

- **`Money` component** now applies `.num` (was bare `tabular-nums`), so every `<Money>` is canonical regardless of any parent font — this alone re-bases Transaction-row amounts from mono to the standard sans.
- **Converted off italic serif** (`display-italic` → `.num`): the shared KPI `Card` value (affects every KPI tile app-wide), Net Worth hero, the spend-donut centre total, and the Dashboard mini net-worth value.
- **Converted off plain/mono sans** (`+ .num`): Splits totals & participant shares; Dashboard balance-sheet `Row`; Debts balance / min-payment / interest / EMI-breakdown figures; Net Worth asset & liability rows + totals; Reports needs/wants cards.
- **Deliberately left as-is:** all page-title / section / panel / modal / brand headings keep `display-italic` (editorial intent — these are not numbers); original-currency micro sub-amounts and the Reports → Period Summary table stay in Mono (a self-contained, internally-consistent numeric table).

No behavioural change — formatting/values are untouched; this is purely the figure *typeface/style*. Design-system note in `CLAUDE.md` updated so future amounts default to `<Money>` / `.num`.

## v6.4.25 — Lead review pass + TD-08 audit triggers + TD-04 extension catch-up (remediation PR #13 batch) *(2026-05-24)*

This release is the lead engineer's review pass over the developer batch that landed v1.0.8 (admin slugify) and v6.4.20..v6.4.24 (consumer items). The batch was delivered as one large bag of working-tree changes rather than the 10 disciplined commits the handoff prompt specified; rather than send it back I've taken it forward, with corrections and the omitted items inline. The PR-number labels the developer applied to each sub-entry (#13/#14/#15/#16/#17) are kept for traceability but they are all part of a single PR #13 batch.

**What the dev delivered cleanly (accepted as-is):**
- v1.0.8 — admin `slugify()` returns `''` for entirely-stripped input (Trim moved after punctuation strip; `ADM-UNIT-006` flipped back to its original assertion).
- v6.4.20 — TD-15: MFA enrolment wrappers in `react/src/lib/auth.ts` + Settings → Security subsection + new `docs/AUTH_HARDENING.md` runbook for the Supabase project-level config (out-of-repo).
- v6.4.21 — TD-13: `budgets.period` / `period_start` / `period_end` columns via a new migration; `budgetMeta.ts` marked deprecated.
- v6.4.22 — TD-09: Six entity-specific `replace_<entity>(h, rows)` RPCs (the dev wrote one per entity instead of the single generic `replace_all_atomic` the prompt requested — functionally equivalent, more verbose, accepted). Adapter `replaceAll` swapped to call the RPC.
- v6.4.23 — TD-10: Sidebar-mounted sync-status badge with 5-state machine (`Local`/`Offline`/`Conflict(s)`/`Syncing`/`Synced`).
- v6.4.24 — TD-12: Memoised selectors in `react/src/lib/selectors.ts` + Dashboard rewired to use them.

**Lead corrections applied (this v6.4.25 entry):**

- **TD-08 audit triggers — missing pieces fixed.** The submitted migration was missing the `memberships` table from the trigger loop (membership changes are exactly the multi-household audit signal we need) and missing `SET search_path = public, pg_temp` on the SECURITY DEFINER function (search-path injection risk). Both fixed in `supabase/migrations/20260524071000_audit_triggers.sql`.
- **Filename case — `SyncStatusBadge.tsx`.** Submitted as `syncstatusbadge.tsx` (lowercase) with imports `'../ui/badge'`. Both would fail TypeScript build on Linux CI (case-sensitive). Renamed to PascalCase + updated `Sidebar.tsx` and Badge imports.
- **Baseline `react/e2e/tests/` ID drift.** Three Playwright specs from the QA scaffolding stream (`TXN-FC-001`, `NWRT-FC-002`, `DEBT-FC-002`) used a parallel functional-case ID format the reconciler refused. Renamed in-place to `CON-E2E-007/008/009` with the FC reference preserved in brackets; catalogued in `docs/TEST_SCENARIOS.md`. Pre-existing issue, not the dev's fault, but blocked the gate.
- **`db/schema.sql` regenerated.** Dev added 6 migrations but never ran `node scripts/db-migrations-check.mjs --fix`, so the snapshot drifted by ~27 KB.
- **Extraneous artifacts removed.** `PR_CHECKLIST.md`, `PR_COMMIT_PLAN.md`, and `scripts/commit_and_validate.ps1` were dev process docs — not part of the deliverable.

**TD-04 extension catch-up (this v6.4.25 entry):**

- TD-04-ext-a (subscriptions table + `paidSubscriptions`/`mrr` KPI plug-in): **accepted** — clean migration, RLS, audit trigger.
- TD-04-ext-b (content_items + content_favorites + KPI plug-in): **accepted**.
- TD-04-ext-c: **scope deviation.** Prompt requested `admin_list_users` / `admin_weekly_trend` / `admin_ai_usage_summary` (which back the existing adminApi.ts fetchers). Dev delivered an entirely different RPC set — `admin_list_subscriptions`, `admin_cancel_subscription`, `admin_get_mrr_by_currency`, `admin_publish_content_item`, `admin_unpublish_content_item`. The work is functionally useful (admin subscription/content lifecycle management) so it's accepted, but the originally-requested 3 read RPCs **remain unaddressed and are re-queued on the lead's workstream.** Migration header comment documents this.

**TD-12 quality note (not fixed in this PR):** the new `selectors.ts` uses `any[]` and `(...args: any[]) => any` extensively. The codebase has real entity types (`Transaction[]`, `Budget[]`, etc.); replacing the `any`s with proper generics is a quality follow-up. ESLint warns but does not error, so the gate passes.

**TD-09 quality note (not fixed in this PR):** the prompt called for a new `CON-UNIT-054` test pinning the `replaceAll → rpc()` swap. Dev did not add it. The path is covered transitively by existing tests in `supabaseAdapter.test.ts`; adding the explicit pin is a follow-up.

**Items resolved this batch (Summary-table marker flipped):** TD-08, TD-09, TD-10, TD-12, TD-13, TD-15, slugify (TD-01 follow-up). TD-04 remains partially resolved (extensions a + b in; admin RPCs c partially in but deviated).

Local automation gate after corrections: PASS (10/10 gates). Catalog 73 ↔ 73 lock-step. db/schema.sql in sync at 8 migrations / ~64 KB.

---

## v6.4.24 — TD-12: Memoised selectors + Dashboard updates (remediation PR #17) *(2026-05-24)*

Centralise and memoise expensive derived metrics used by the Dashboard. Introduces `lib/selectors.ts` which exposes memoized selectors for monthly aggregates, pulse score, insights, category spend, recent transactions, and balance-sheet totals. `Dashboard.tsx` now consumes these selectors to avoid redundant O(n) recomputation on unrelated state changes.

- [`react/src/lib/selectors.ts`](react/src/lib/selectors.ts) — memoized selectors for derived metrics.
- [`react/src/pages/Dashboard.tsx`](react/src/pages/Dashboard.tsx) — switched to the memoized selectors.

**TD-12 status:** selectors added and Dashboard updated; run `node scripts/automation-run.mjs` locally before committing.

## v6.4.23 — TD-10: Sync status badge + Sidebar mount (remediation PR #16) *(2026-05-24)*

Adds a small sync status badge to the sidebar header to surface local/cloud sync state and queued operations. The badge reflects `Local`, `Offline`, `Syncing`, `Synced`, and `Conflict(s)` states by polling the adapter for pending queue and conflict counts.

- [`react/src/components/layout/syncstatusbadge.tsx`](react/src/components/layout/syncstatusbadge.tsx) — new UI component showing adapter sync state.
- [`react/src/components/layout/sidebar.tsx`](react/src/components/layout/sidebar.tsx) — mounts `SyncStatusBadge` next to the notification center in the sidebar header.

**TD-10 status:** front-end badge added; validate UI and run `node scripts/automation-run.mjs` locally before committing release.

## v6.4.22 — TD-09: Atomic replace_all RPC & adapter call (remediation PR #15) *(2026-05-24)*

Adds server-side `replace_<entity>(h uuid, rows jsonb)` RPCs to perform atomic bulk-replace operations for domain tables (transactions, budgets, goals, debts, assets, members). The `SupabaseAdapter.replaceAll()` implementation now calls the appropriate RPC for improved performance and correctness during imports and initial syncs.

- [`supabase/migrations/20260524073000_replace_all_rpc.sql`](supabase/migrations/20260524073000_replace_all_rpc.sql) — new RPCs: `replace_transactions`, `replace_budgets`, `replace_goals`, `replace_debts`, `replace_assets`, `replace_memberships`.
- [`react/src/lib/supabaseAdapter.ts`](react/src/lib/supabaseAdapter.ts) — `replaceAll()` now invokes server RPCs and returns the inserted rows.

**TD-09 status:** migration added; run `node scripts/db-migrations-check.mjs --fix` locally and then `node scripts/automation-run.mjs` to validate gates before committing release.

## v6.4.21 — TD-13: Budgets period column migration (remediation PR #14) *(2026-05-24)*

Schema migration release. Adds `period`, `period_start`, `period_end` to the `budgets` table (migration: `supabase/migrations/20260524070000_budgets_add_period.sql`). Client row mappers updated to read/write these columns; local `budgetMeta.ts` kept as a compatibility shim for one release and marked deprecated.

- [`supabase/migrations/20260524070000_budgets_add_period.sql`](supabase/migrations/20260524070000_budgets_add_period.sql) — adds `period` (text default 'monthly'), `period_start` (date), and `period_end` (date) to `budgets` and a `CHECK` constraint over allowed period values.
- [`react/src/lib/supabaseAdapter.ts`](react/src/lib/supabaseAdapter.ts) — row mappers `rowToBudget` / `budgetToRow` now include `period`, `period_start`, and `period_end`.
- [`react/src/lib/budgetMeta.ts`](react/src/lib/budgetMeta.ts) — marked deprecated pending migration roll-out; the store still writes local period metadata for a single release to preserve UX during the migration window.

**TD-13 status:** migration file added. Developer must run `node scripts/db-migrations-check.mjs --fix` locally to regenerate `db/schema.sql` before gating and release.

## v6.4.20 — TD-15: MFA enrolment & Auth hardening (remediation PR #13) *(2026-05-24)*

Security release. Adds client-side helpers and a Settings UI subsection to enrol and manage TOTP MFA factors via Supabase Auth. Also adds `docs/AUTH_HARDENING.md` with a short runbook and rollout recommendations.

- [`react/src/lib/auth.ts`](react/src/lib/auth.ts) — new MFA helper wrappers: `enrollMfaTotp()`, `verifyMfaEnrolment()`, `listMfaFactors()`, `unenrollMfaFactor()` to keep pages decoupled from Supabase internals.
- [`react/src/pages/Settings.tsx`](react/src/pages/Settings.tsx) — new **Security** panel: enable TOTP enrolment, QR provisioning, verification, and factor unenrolment. Cloud-mode only.
- [`docs/AUTH_HARDENING.md`](docs/AUTH_HARDENING.md) — runbook for Supabase MFA, leaked-password protection, and recommended rate limits.

**TD-15 status:** remediation started; Settings UI and helpers implemented. Rollout: opt-in enrolment exposed in Settings; enforcement TBD per policy.

## v6.4.19 — TD-03 phase B: concurrency wired across all CRUD + in-app conflict banner (remediation PR #12) *(2026-05-23)*

**Closes TD-03.** Phase A (PR #11) added the cloud-side compare-and-set and the dead-letter bucket; this PR threads the precondition through every CRUD entity and surfaces conflicts to the user with an in-app banner. After this lands, two household members editing the same row no longer silently overwrite each other anywhere in the app.

- [`react/src/types.ts`](react/src/types.ts) — `Budget`, `Goal`, `Debt`, `Asset` interfaces gain `updated_at?: string`. `Transaction` already had it. Documented with TD-03 phase B JSDoc tags.
- [`react/src/lib/supabaseAdapter.ts`](react/src/lib/supabaseAdapter.ts) — the four row mappers `rowToBudget`, `rowToGoal`, `rowToDebt`, `rowToAsset` now thread `r.updated_at` into the returned JS shape (matching the pattern `rowToTxn` already used).
- [`react/src/store.ts`](react/src/store.ts) — `upsertBudget` / `upsertGoal` / `upsertDebt` / `upsertAsset` mirror PR #11's `upsertTransaction`: pass `record.updated_at` as the 4th `adapter.upsert` argument when both id and version are present (= an edit). New-record inserts still go through the legacy path. **Every CRUD modal in the app is now protected.**
- [`react/src/lib/hybridAdapter.ts`](react/src/lib/hybridAdapter.ts) — new `clearConflicts()` method drops the dead-letter bucket. Paired with `pendingConflictCount()` from PR #11.
- [`react/src/components/layout/SyncConflictBanner.tsx`](react/src/components/layout/SyncConflictBanner.tsx) **(new)** — polls `adapter.pendingConflictCount()` every 5 seconds; renders nothing while count is 0; otherwise shows a banner ("N edits couldn't be saved — A household member edited the same item before you…") at the top of the main content area with a Dismiss button that calls `clearConflicts()`. Cloud-mode-only (the LocalStorageAdapter has neither method, both calls are guarded by `typeof` checks; local-mode users never see the banner).
- [`react/src/components/layout/Layout.tsx`](react/src/components/layout/Layout.tsx) — mounts `<SyncConflictBanner />` above `{children}` inside the main content area.

**On testing — explicit rationale:** the conflict-detection mechanism is entity-agnostic (CON-UNIT-051..053 from PR #11 exercise it via `'transactions'`; the same function handles `budgets` / `goals` / `debts` / `assets` identically — only the entity-string argument differs). Adding four near-duplicate vitest specs for the other entities would have proven nothing CON-UNIT-051..053 don't already prove. The PR's new surface is: type-system additions (compile-time enforced by `tsc`), row-mapper field additions (type-system enforced by the return type), store-action argument threading (type-system enforced + verified by manual modal save), and a presentational banner with a 5-second poll (visually verifiable). The full automation gate's typecheck + build + existing CON-UNIT-051..053 give the merge-time signal that matters here.

**TD-03 status:** marked **Resolved** in [`TECH_DEBT.md`](TECH_DEBT.md). The longer-term work (CRDT / per-field merge for high-contention entities) is outside the register's TD-03 scope and would be a separate, future item.

---

## v6.4.18 — TD-03 phase A: optimistic concurrency at the cloud boundary (remediation PR #11) *(2026-05-23)*

Begins **TD-03 (optimistic concurrency)**. The cloud adapter previously did last-write-wins on every upsert, so two members of a shared household editing the same row would silently overwrite each other. This PR adds the *plumbing* and *detection* — a guarded UPDATE with an `updated_at` precondition, a typed `ConcurrencyConflictError`, and a dead-letter bucket on the sync queue — and wires it through one real call site (Transactions edit) as the proof. Phases B (UI surfacing) and C (wire the other CRUD entities) are queued PRs.

- [`react/src/lib/dataAdapter.ts`](react/src/lib/dataAdapter.ts) — `DataAdapter.upsert` interface gains an optional `expectedUpdatedAt?: string` 4th argument. LocalStorageAdapter accepts it for parity (single-user, no concurrency to enforce) and ignores it.
- [`react/src/lib/supabaseAdapter.ts`](react/src/lib/supabaseAdapter.ts) — new exported `ConcurrencyConflictError` class. `upsert` splits into two paths: **guarded** when `expectedUpdatedAt` is supplied AND the record has an id, performs `.update(row).eq('id', id).eq('updated_at', expected).select().maybeSingle()`; zero rows matched ⇒ throws `ConcurrencyConflictError`. **Legacy** when no precondition is supplied — back-compat last-write-wins upsert. The `updated_at` field is stripped from the row body since the DB's `touch_*` trigger sets it on every UPDATE.
- [`react/src/lib/hybridAdapter.ts`](react/src/lib/hybridAdapter.ts) — `QueueOp` carries the new `expectedUpdatedAt`. `flushQueue` catches `ConcurrencyConflictError` and moves the op to a new `ff_sync_conflicts` localStorage bucket (instead of pushing back into the main queue, which would jam every later op). New `pendingConflictCount()` method for TD-03 phase B's UI toast.
- [`react/src/store.ts`](react/src/store.ts) — `upsertTransaction` now threads `t.updated_at` as the precondition whenever the record has both an `id` and an `updated_at` (i.e. an edit). New transactions (no version yet) still go through the legacy insert path. **First real call site exercising the concurrency path**; the other 4 CRUD entities (Budget, Goal, Debt, Asset) are wired in PR #12.
-]  [`react/src/lib/__tests__/supabaseAdapter.test.ts`](react/src/lib/__tests__/supabaseAdapter.test.ts) **(new)** — 3 ID-tagged tests (`CON-UNIT-051..053`) using a minimal vitest-mocked Supabase client: happy-path guarded UPDATE returns the server row; `data: null` on stale precondition throws `ConcurrencyConflictError`; no-precondition path still uses the legacy `.upsert()`.

**Out of scope (deferred to PR #12+):**

- UI surfacing of conflicts (toast + "Review" affordance using `pendingConflictCount()`).
- Threading `updated_at` through Budget / Goal / Debt / Asset store actions.
- Auto-refetch and present-conflict-in-modal flows for user-driven merge.

---

## v6.4.17 — TD-01 phases C+D: decimal money — amortisation + cloud boundary (remediation PR #10) *(2026-05-23)*

**Closes TD-01.** Combined Phase C (amortisation engine) and Phase D (cloud boundary + types) into a single release. After this PR, the entire money-handling pipeline — FX boundary, aggregations, EMI / interest chains, and cloud row-mappers — runs through dinero-quantised math in the appropriate currency. Aggregation drift across long histories and 300-month amortisation schedules is gone.

**Phase C — `react/src/lib/amortization.ts`:**

- New internals: `quantizeDinero` (banker's-round to native currency exponent) + `rateAsScaled` (express a JS float rate as the scaled factor `dinero.multiply` accepts).
- [`splitPayment`](react/src/lib/amortization.ts) now takes an **optional `currency`** parameter. When supplied, both interest *and* principal are computed in dinero (subtract in dinero space, then `fromDinero` at the edge), so `splitPayment(200000, 5, 1170, 'GBP')` returns exactly `{interest: 833.33, principal: 336.67}` — not the float-drift `336.66999999999996` you'd get from `1170 - 833.33` in raw JS. Default (no currency) preserves legacy float behaviour for back-compat.
- [`calculateAmortizationSchedule`](react/src/lib/amortization.ts) carries the outstanding balance as a Dinero in `debt.currency` across the entire iteration (`subtract(outstandingD, principalD)`) so a 300-row schedule can't accumulate per-step drift. New regression pin `CON-UNIT-047` asserts `Σ row.principal ≈ debt.currentBalance` within £0.01.
- [`applyPayment`](react/src/lib/amortization.ts) threads `debt.currency` into `splitPayment` and recomputes `newOutstanding` via dinero subtract. `CON-UNIT-036` tightened from `toBeCloseTo` to strict `.toBe`.
- [`interestSummary`](react/src/lib/amortization.ts) reuses Phase B's `sumDinero` to fold lifetime / YTD / principalPaid in integer minor units. `CON-UNIT-039` tightened to strict `.toBe`.
- `computeEmi` / `computeRemainingMonths` intentionally **stay as float derivations** — their outputs feed into the dinero-quantised layers above where currency-aware exactness lives.

**Phase D — cloud boundary + types:**

- [`react/src/lib/money.ts`](react/src/lib/money.ts) exports a new `parseMoneyFromCloud(v)` helper. Accepts string (the Supabase `numeric(15,2)` JSON serialisation), number, null, undefined, or empty. Returns 0 on null / undefined / empty / NaN. Centralises the cloud-boundary contract.
- [`react/src/lib/supabaseAdapter.ts`](react/src/lib/supabaseAdapter.ts) row mappers (`rowToTxn`, `rowToBudget`, `rowToGoal`, `rowToDebt`, `rowToAsset`) replace inline `Number(r.amount)` casts with `parseMoneyFromCloud(...)`. Non-money decimals (interest_rate %, rate_to_usd) keep their plain `Number()` on purpose — different failure semantics. Two new tests `CON-UNIT-049/050` pin the contract.
- [`react/src/types.ts`](react/src/types.ts) gains a header-level **"Money fields (TD-01 discipline)"** doc block that documents the dinero contract end-to-end and notes that a future `Money` opaque type will move the guarantee from runtime convention to the compiler.
- **`Money` UI component** ([`react/src/components/ui/Money.tsx`](react/src/components/ui/Money.tsx)) was audited: it only calls `fmt()` / `fmtShort()` — pure formatting, no math. Unchanged.

**Test catalog growth:** 4 new pins (`CON-UNIT-047/048/049/050`); 5 tightened from `toBeCloseTo` to strict `.toBe`. Coverage table updated to 50 consumer-unit / 67 total. [`docs/TEST_SCENARIOS.md`](docs/TEST_SCENARIOS.md) catalog in lock-step.

**TD-01 status:** the `[TD-01]` entry can now be marked **Resolved** in `TECH_DEBT.md`. The remaining future-cleanup work (introducing a `Money` opaque type to move runtime convention into the compiler) is a separate, smaller PR — not part of TD-01's spec.

---

## v6.4.16 — TD-01 phase B: decimal money — aggregations in dinero space (remediation PR #9) *(2026-05-23)*

Continues the TD-01 rollout. Phase A (PR #8) wired the FX boundary through dinero so each per-call `convert()` was exact. Phase B migrates every **aggregator** in [`react/src/lib/calculations.ts`](react/src/lib/calculations.ts) to fold in dinero space — integer-cents arithmetic with `add` — instead of using JS `+` on `number`. The reductions no longer accumulate float drift across many transactions.

- [`react/src/lib/money.ts`](react/src/lib/money.ts) — exports `addDinero` (re-export of dinero's `add`), new `dineroZero(code)` for accumulator initial state, new generic `sumDinero(items, getDinero, baseCode)` helper.
- [`react/src/lib/calculations.ts`](react/src/lib/calculations.ts) — internal-only `effectiveDinero(t, base, rates)` produces a Dinero in the base currency; every public aggregator (`monthlyData`, `totalBalance`, `spendByCategory`, `spendByCategoryInRange`, `totalAssets`, `totalLiabilities`, `liquidAssets`, `totalMonthlyDebtPayment`, `splitsOutstanding`) now sums Dineros and calls `fromDinero` only at the function edge. `effectiveAmount` is kept as a thin `number`-returning wrapper for callers that don't yet need Dinero. Public signatures unchanged — every existing call site works without any change.
- Tests in [`calculations.test.ts`](react/src/lib/__tests__/calculations.test.ts) **tightened from `toBeCloseTo(x, 10)` to strict `.toBe(x)`** where exactness is now achievable (which is most of them — single-currency integer sums + the FX cases that are quantised at the boundary). The previously-tolerant assertions were a hedge against the very drift that's gone.
- **New `CON-UNIT-046`** pins TD-01 phase B's signature improvement directly: summing 10 expenses of `$0.10` returns exactly `-1.00` via `totalBalance`. Before phase B, the reducer drifted into `-1.0000000000000002` because of the classic `0.1 + 0.2 ≠ 0.3` float problem.
- `computeEmi` / `splitEmiPortions` (loan math) intentionally **not yet migrated** — they go to Phase C (PR #10) alongside the rest of `amortization.ts`.

Phases C (PR #10) and D (PR #11) remain queued.

---

## v6.4.15 — TD-01 phase A: decimal money — dinero.js at the FX boundary (remediation PR #8) *(2026-05-23)*

**TD-01 (decimal money) starts here.** Phase A of a phased rollout. The `convert()` FX function previously did `(amount / rFrom) * rTo` on raw JS floats, which drifted across round-trips and across aggregations — the canonical TD-01 example. This release wires `convert()` through **dinero.js v2** with banker's rounding at the FX boundary. The public signature is unchanged (number → number, major units), so no caller has to change today; the gain is that the conversion math is now exact integer arithmetic with currency-aware re-quantisation at the edge.

- [`react/src/lib/money.ts`](react/src/lib/money.ts) — new boundary layer. `CURRENCY_REGISTRY` registers all 12 supported currencies with the `@dinero.js/currencies` definitions (JPY=0 decimals natively); `toDinero` / `fromDinero` scale into and out of integer minor units; `convertViaUsdRates` does the FX through USD as before but each leg is dinero-mediated. After every conversion the result is re-quantised to the target currency's native exponent using banker's (half-to-even) rounding, so sub-cent precision from `(amount × rateScaled)` does not bleed through to subsequent operations.
- [`react/src/lib/format.ts`](react/src/lib/format.ts) — `convert()` body now delegates to `convertViaUsdRates(toDinero(...))` then `fromDinero(...)`. Same arguments, same return type, exact math in the middle.
- [`react/src/lib/__tests__/money.test.ts`](react/src/lib/__tests__/money.test.ts) — six new ID-tagged unit tests (`CON-UNIT-040..045`) pinning the contract every later phase will lean on (registry coverage, fallback semantics, JPY zero-decimals, and the quantisation that fixed CON-UNIT-006).
- [`react/src/lib/__tests__/format.test.ts`](react/src/lib/__tests__/format.test.ts) — **`CON-UNIT-006` flipped** from a TD-01 *characterization* test ("round-trip USD→EUR→USD does NOT return the original") to a positive assertion of the fixed behaviour using strict `.toBe(start)` rather than `toBeCloseTo`. The catalog row in [`docs/TEST_SCENARIOS.md`](docs/TEST_SCENARIOS.md) is updated to match.
- New dev-deps: `dinero.js@^2.0.2` (stable) + `@dinero.js/currencies@^2.0.0-alpha.14`.

**What this PR explicitly does *not* do** (planned for the next phases):

- Phase B (PR #9): migrate `calculations.ts` aggregations to operate in dinero internally so sums no longer drift across `reduce`.
- Phase C (PR #10): migrate `amortization.ts` (EMI/interest split/schedule/payment apply).
- Phase D (PR #11): adapter row mappers, `Money` UI component, types.ts `Money` opaque type, charts.

The bundle gains ~5 KB tree-shaken from dinero.js v2.

---

## v6.4.14 — Route-level code splitting (remediation PR #5) *(2026-05-23)*

Performance release. Addresses **TD-11** from the technical-debt register. All page imports in [`react/src/App.tsx`](react/src/App.tsx) now use `React.lazy` and the `<Routes>` blocks are wrapped in `<Suspense fallback={…}>`. Because Recharts is imported only from `components/charts/Charts.tsx` (used by Dashboard, Reports, NetWorth), the route-level split means Recharts ships only in those three route chunks — not in the initial bundle, and not on the Transactions / Budgets / Goals / Settings / Help paths. Faster first paint on mobile and low-bandwidth connections. No user-visible change.

- [`react/src/App.tsx`](react/src/App.tsx) — every page import (consumer routes + auth routes + a new `__e2e_error` test route for `CON-E2E-005`) converted to `React.lazy`; `<Suspense>` boundary added inside `AppShell` and around the auth-only `<Routes>` block.
- [`react/e2e/tests/code-splitting.spec.ts`](react/e2e/tests/code-splitting.spec.ts) — new spec **`CON-E2E-006`** observes network requests on `/transactions` (asserts no Recharts chunk is fetched), then on `/dashboard` (asserts it is). Catalogued in [`docs/TEST_SCENARIOS.md`](docs/TEST_SCENARIOS.md).
- **Review note (engineering):** the originally-submitted patch also tried to wrap every individual Recharts primitive (`<AreaChart>`, `<Area>`, `<XAxis>`, …) in its own `React.lazy`/`Suspense` inside `Charts.tsx`. Recharts requires its primitive children to register synchronously with their parent, so that approach broke chart rendering and produced N+1 redundant dynamic imports of the same module. Reverted to the original `Charts.tsx`; the route-level split above is the correct and sufficient implementation.

---

## v6.4.13 — Top-level error boundary (remediation PR #4) *(2026-05-23)*

Resilience release. Addresses **TD-05**. A top-level `<ErrorBoundary>` now wraps `<BrowserRouter>` in [`react/src/main.tsx`](react/src/main.tsx). Any uncaught render error now shows a friendly fallback ("Something broke — Your data is safe locally") with a Try-Again button that resets the boundary state. No data loss; localStorage and the sync queue are untouched.

- [`react/src/components/ui/ErrorBoundary.tsx`](react/src/components/ui/ErrorBoundary.tsx) — new class component using `getDerivedStateFromError` + `componentDidCatch`; Sentry wiring placeholder for a future PR.
- [`react/src/main.tsx`](react/src/main.tsx) — boundary mounted at the React root, outside `<BrowserRouter>` so route errors are also caught.
- [`react/src/pages/__e2e__ErrorTest.tsx`](react/src/pages/__e2e__ErrorTest.tsx) — tiny page that throws on render, mounted at `/__e2e_error` (added in v6.4.14's App route table) purely so the E2E test below can exercise the boundary.
- [`react/e2e/tests/error-boundary.spec.ts`](react/e2e/tests/error-boundary.spec.ts) — new spec **`CON-E2E-005`** navigates to `/__e2e_error`, asserts the fallback, clicks Try Again, asserts recovery. Catalogued in [`docs/TEST_SCENARIOS.md`](docs/TEST_SCENARIOS.md).

---

## v6.4.12 — Transactions list virtualization (remediation PR #3) *(2026-05-23)*

Performance-only release. Addresses **TD-17**. The Transactions page list now uses `@tanstack/react-virtual`, so the DOM contains only O(viewport) row nodes even with 10 000+ transactions. Visible UI, filters, search, day-filter chip, calendar toggle, and row actions are all unchanged.

- [`react/src/pages/Transactions.tsx`](react/src/pages/Transactions.tsx) — list block wrapped in a fixed-height scroll container driven by `useVirtualizer`. Estimate size 64 px (matches `TxnRow`'s `py-2.5` + 1px border); overscan 8 rows.
- [`react/src/components/transactions/TxnRow.tsx`](react/src/components/transactions/TxnRow.tsx) — added `data-testid="txn-row"` so the acceptance check (`document.querySelectorAll('[data-testid="txn-row"]').length` ≤ ~40 at 10k rows) is reproducible.
- [`react/package.json`](react/package.json) — added `@tanstack/react-virtual` dependency.
- **Review note (engineering):** the originally-submitted patch placed the `useRef` and `useVirtualizer` calls *inside the JSX*, as raw `const …` statements between the `<EmptyState />` ternary and the closing `</Panel>`. That was a TypeScript compile error and a Rules-of-Hooks violation. Hoisted into the component body, after `filtered` is defined and before the JSX return.

---

## v6.4.11 — Test scenarios master catalog + per-scenario audit evidence (remediation PR #2) *(2026-05-23)*

Tooling-only release, no user-visible change. Establishes a **master Test Scenarios catalog** and rebuilds the automation report so every run leaves durable, per-scenario evidence for both success and failure. Closes finding **N1** of the 2026-05-22 assessment for the consumer side by tagging every consumer test with a stable ID.

- [`docs/TEST_SCENARIOS.md`](docs/TEST_SCENARIOS.md) — new master catalog. Every scenario in code is listed here with a stable `{APP}-{LAYER}-{NNN}` ID, the file it lives in, a description, and any TD link. Regression-managed: PRs adding / renaming / removing scenarios must update this file in the same commit.
- [`scripts/test-scenarios-check.mjs`](scripts/test-scenarios-check.mjs) — CI reconciler. Walks `react/src/lib/__tests__`, `react/e2e/tests` (and admin's). Fails the gate on: orphan ID in code, orphan ID in doc, duplicate IDs, retired-ID reuse, or file-column drift.
- Consumer tests now all carry their TS ID in the title: `CON-UNIT-001..039` across `format.test.ts` / `calculations.test.ts` / `amortization.test.ts`; `CON-E2E-001..004` in `smoke.spec.ts`. One characterization test pins TD-01: `CON-UNIT-006 · [TD-01] round-trip USD→EUR→USD does NOT return exactly the original`.
- [`scripts/automation-run.mjs`](scripts/automation-run.mjs) — report rewrite. Every run's `report.md` now includes a **Test scenarios** section: per-app × per-layer pass/fail/total matrix, the catalog reconciler line, **Failure details** with the error message + stack excerpt per failed TS ID, and a complete **Pass register** capturing every passing TS ID + duration for audit. `summary.json` gains a `scenarios.records` array. The run register `automation-runs/INDEX.md` now includes a Scenarios cell on every row.

---

## v6.4.10 — ESLint floor (remediation PR #1) *(2026-05-23)*

First real linter for the consumer app — the old `npm run lint` was `tsc --noEmit` (now preserved as `npm run typecheck`). Tooling-only, no user-visible change. Closes finding **N2** of the 2026-05-22 remediation assessment ("there is no real linter anywhere") and gives every later [`TECH_DEBT.md`](TECH_DEBT.md) PR a real `react-hooks/exhaustive-deps` and unused-vars signal.

- [`react/eslint.config.js`](react/eslint.config.js) — new flat config: `@eslint/js` recommended, `typescript-eslint` recommended (non-type-checked, fast), `react-hooks` plugin. `rules-of-hooks` as error. `exhaustive-deps`, `no-unused-vars`, `no-explicit-any` as warnings — surfaces the pre-existing debt without blocking the gate, ratcheted to errors as the related TECH_DEBT items land.
- [`react/package.json`](react/package.json) — `lint` now runs `eslint .`; added `typecheck` script for the previous `tsc --noEmit` behaviour. Added dev-deps: `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals`.
- `e2e/` is ignored by ESLint (matches tsconfig); Playwright's fixture-injection `use` callback was being mis-flagged as a React hook.
- [`react/src/pages/Households.tsx`](react/src/pages/Households.tsx) — the first real bug ESLint found: a `cond && fn()` short-circuit at statement position in the invite-sent handler (no-op as written). Rewritten as `if (cond) fn()`.
- [`scripts/automation-run.mjs`](scripts/automation-run.mjs) — relabelled the existing `lint` gate to "ESLint" and split out a new "type-check" gate so both stay independently visible in `report.md`.

---

## v6.4.9 — Calendar: all months, recurring projection, day filter, on-demand *(2026-05-22)*

Reworked the Transactions expense calendar ([`react/src/components/transactions/TxnCalendar.tsx`](react/src/components/transactions/TxnCalendar.tsx)) from a single-month grid into a full navigable calendar.

- **All months, with navigation.** ‹ / › step through any past or future month; a "Today" shortcut jumps back to the current month. Logged-expense days are highlighted across every month, not just the filtered one.
- **Future recurring projection.** Upcoming days that a recurring **expense** schedule will fire on are shown in a distinct **denim** colour ("upcoming"), so you can see planned payments ahead. Past/today shows actual logged expenses (sage).
- **Clickable days.** Tapping a day filters the transaction list to that exact date (with a clearable chip); tapping it again clears. Works on past, today and future days.
- **On-demand.** The calendar is hidden by default and toggled by a new **Calendar** icon button beside *Add Transaction* — it no longer always occupies the top of the page.
- Today is ringed; the selected day is outlined.

---

## v6.4.8 — Auto-even split shares *(2026-05-22)*

Splitting a bill no longer requires mental math.

- [`react/src/components/transactions/TransactionFormModal.tsx`](react/src/components/transactions/TransactionFormModal.tsx):
  - Split shares now **default to an even split** of the bill and **auto-rebalance** as participants are added/removed or the amount changes.
  - The split stays in auto mode until you **type a share by hand** — then it respects your numbers and stops rebalancing (so manual amounts are never clobbered).
  - The toolbar button shows the current mode (`⚖ Even (auto)` vs `⚖ Even split`) and one click resets to an even split. Editing a participant's *name* never disturbs shares.

---

## v6.4.7 — Calendar view on Transactions page *(2026-05-22)*

Added a calendar visualization to the Transactions page, showing which days of the selected month had expenses logged (highlighted) versus missed (unhighlighted). The calendar is always in sync with the user's transaction data, including backend/cloud and local changes.

### Features
- [`react/src/pages/Transactions.tsx`](react/src/pages/Transactions.tsx), [`react/src/components/transactions/TxnCalendar.tsx`](react/src/components/transactions/TxnCalendar.tsx):
  - Calendar grid for the selected month, with each day showing if an expense was logged.
  - Days with expenses are highlighted; missed days are dimmed.
  - Works with all transaction filters and is always up to date with backend/local data.

---

## v6.4.6 — Linked accounts, dynamic needs/wants, AI usage metrics, split-bill UX *(2026-05-21)*

A feature release plus a stabilisation pass. **Two files (`TransactionFormModal`, `NetWorth`) had shipped in a non-compiling state in an earlier v6.4.6 draft** — both were reconstructed cleanly, the build is green again, and the intended features were re-implemented correctly.

### Build stabilisation (regressions fixed)
- `TransactionFormModal.tsx` had been corrupted (split-bill JSX pasted at module top-level, imports/interfaces/component signature deleted). Rebuilt from the v6.4.5 base.
- `NetWorth.tsx` had a temporal-dead-zone crash (an effect referencing `assets`/`toast` before declaration) plus type errors (`includes(undefined)`, invalid toast kind `'warn'`). Effect moved below declarations, runs once per mount, kind corrected to `'warning'`.
- `aiSummary.ts` — removed unwired stub sub-agents that intercepted "how can I save / insights" questions and returned canned `(stub)` text instead of the real data-driven answers.

### Linked accounts drive payments — [`react/src/lib/accounts.ts`](react/src/lib/accounts.ts)
- A user's spendable accounts are now derived from **Net Worth**: cash + bank assets (`cash`/`checking`/`savings`) + credit-card debts. The Add-Transaction **Account** dropdown lists exactly these (encoded as `cash` / `asset:<id>` / `debt:<id>`).
- Expense, income and transfer now **require** an account. Legacy `PAYMENT_METHODS` values still resolve for display so historical rows are never lost. `PaymentMethodChip` resolves all three forms.

### Dynamic needs/wants categorisation — [`react/src/lib/categorization.ts`](react/src/lib/categorization.ts)
- The need/want mapping now lives in the **`category_classifications`** DB table (admin-editable, globally read), with the static `NEEDS_WANTS_MAP` as offline fallback. Reports' Needs-vs-Wants panel reads the live mapping.

### AI usage metrics — [`react/src/lib/aiUsage.ts`](react/src/lib/aiUsage.ts)
- Each Ask-FinFlow message is classified for **intent** + **sentiment** locally and logged to the **`ai_usage`** table. Privacy-first: only intent, sentiment and message length are stored — never message content. Surfaced for the business in the admin app's new AI Intelligence page.

### Split-bill UX & recurring modal
- Split editor: auto-equal split, one-click add/remove participants, Backspace/Delete on an empty row removes it, and live validation messages.
- `Recurring.tsx`: schedules are now fully editable (pre-filled on edit) with graceful empty/invalid day-of-month handling.

### Schema (additive, non-destructive)
- New tables `category_classifications` and `ai_usage` (RLS via `is_member` / `is_admin`), plus the `admin_ai_usage_summary()` SECURITY DEFINER RPC for the admin dashboard.

---

## v6.4.5 — Help page: real screenshots & interactive GIFs *(2026-05-21)*

The Help page now teaches with **real captures of the live app**, not prose alone.

### Help content consolidated
- [`react/src/pages/Help.tsx`](react/src/pages/Help.tsx) — reduced from 17 fragmented topics to **8 focused, searchable topics**, each backed by a real screenshot or animated walkthrough. Images render in a `<figure>` with a caption and an `onError` fallback that hides the figure if an asset is ever missing (so the page never shows a broken-image icon).

### Eight media assets shipped to `react/public/help/`
A mix of **WEBP screenshots** and **animated GIFs**, all captured from the real React app (v6.4.x design — Pip mascot, FinFlow wordmark, coral buttons) seeded with representative family data:
- `getting-started.webp`, `pulse.webp`, `budgets-goals.webp`, `debt-networth.webp`, `planner.webp`, `settings.webp` — full-screen WEBP (16–53 KB each, 1340 px wide).
- `add-transaction.gif`, `split-bill.gif` — interactive walkthroughs showing the Add Transaction modal being filled in and a bill being split (≈ 220–250 KB each, 1080 px wide).

### Reproducible capture pipeline
- [`react/scripts/capture-help.mjs`](react/scripts/capture-help.mjs) — drives the locally-installed Chrome via `puppeteer-core` against a local-mode preview build (localStorage adapter, seeded demo data), screenshots each page/modal, and encodes the GIFs with `gifenc` + `pngjs` (pure-JS, no native deps). Static frames are converted PNG→WEBP and the GIFs downscaled via `sharp-cli`. Re-run with `BASE=<preview-url> node scripts/capture-help.mjs`.
- Dev-only deps added: `puppeteer-core`, `gifenc`, `pngjs`. No impact on the production bundle.

---

## v6.4.4 — FinFlow Design System v2 alignment *(2026-05-21)*

Adopted the **FinFlow Design System v2** handoff from claude.ai/design (tokens.css + lib.jsx `FF.*` specs). Visual/styling only — no behaviour or data changes.

### Tokens
- Injected the full `--ff-*` token set into [`react/src/index.css`](react/src/index.css): warm-paper surfaces (canvas / surface / shell), 4-step ink scale (`ink` → `ink-4`), line steps (`line` / `line-2` / `line-strong`), coral brand ramp (coral / soft / tint / deep / deep-tint), semantic colours + tints (sage, olive, honey, butter, denim, plum), the type scale, radii (4/6/8/14/20/pill), paper-soft shadows (1–4), and motion eases/durations. Added a dark-theme remap so the tokens stay correct in dark mode.

### Components (matched to `lib.jsx` FF specs)
- **Buttons** — radius **9px**, weight 600, 5 kinds: `primary` (coral), `ink` (dark solid), `ghost` (outline), `secondary`/`subtle` (surface fill), `danger`/`destruct` (terracotta) + `.btn-sm` / `.btn-lg` size modifiers.
- **Inputs** — height 40, radius 8, surface bg, line-2 border, coral focus ring; textareas/selects keep auto height.
- **Cards** — `.panel` now matches `FF.Card` (surface bg, `--ff-line` border, r8, shadow-1).
- `.mono-label` (mono 10px / 0.14em / ink-3) and `.display-italic` (serif) aligned.

### Brand — Pip + wordmark
- **Pip mascot** upgraded from the simplified circle to the real design-system character — coral radial-gradient body, **eyes, cheeks, and a smile** — in the consumer Sidebar, MobileBar, and `public/favicon.svg`.
- **Wordmark** now renders **"Fin" upright + "Flow" italic in coral** (Newsreader serif, weight 500, -0.015em) per the FF.Wordmark spec, replacing the all-italic treatment.

Verified in-browser: sidebar shows the faced Pip + Fin*Flow* wordmark, coral FF buttons, paper-warm cards.

---

## v6.4.3 — Split-transaction creation + button/input styling *(2026-05-20)*

Two regressions vs the vanilla app, both fixed.

### Split transactions can be created again
The vanilla shell let you split a bill across participants; the React `TransactionFormModal` only *preserved* an existing `split` (`initial?.split`) — there was **no UI to create one**, so the feature was effectively missing even though the DB (`extras.split`), the `Splits` page, and `splitsOutstanding()` all supported it.

- [`react/src/components/transactions/TransactionFormModal.tsx`](react/src/components/transactions/TransactionFormModal.tsx) — added a "🤝 Split this bill" section (expense only): "who paid" (you / someone else), a participants-and-shares editor (add/remove people, You is fixed), and a live "shares total vs bill" validator. On save it builds the full `SplitInfo` (`totalAmount`, `yourShare`, `paidBy`, `participants[]` with correct `paid` flags) and validates that shares sum to the bill. Editing an existing split rehydrates the form.
- Cash-flow stays correct: `effectiveAmount()` already counts only `yourShare`; the full bill is stored as `amount` + `split.totalAmount`.
- **Verified e2e:** created a ₹100 dinner split (You ₹50 / Alex ₹50, you paid) → persisted to `extras.split` in Supabase → Splits page shows "Owed to you ₹50.00 · 1 outstanding item".

### Buttons & inputs on the ported pages now render styled
The 7 v5-ported pages (Budgets, Goals, Debts, Net Worth, Splits, Settings) used `className="btn-primary"` / `btn-secondary` / `btn-ghost` / `input`, but **those classes were never defined** — Tailwind's preflight strips native button styling, so they rendered as plain clickable text and unstyled inputs.

- [`react/src/index.css`](react/src/index.css) — added `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, and `.input` to the `@layer components` block, using the Paper-Warm design tokens (coral primary, hover lift, focus ring). This fixes every Add/Edit/Delete affordance and form field across all ported pages at once.
- **Verified:** Budgets/Goals/Debts/Net Worth now show proper coral buttons and styled inputs.

---

## v6.4.2 — Critical sync fix: cloud writes never persisted *(2026-05-20)*

**Severity: critical (data integrity).** Locally-created records — transactions, budgets, goals, debts, assets — were never reaching Supabase. They lived in the local cache and looked saved in the UI, but every cloud write silently failed and the record sat in the sync queue forever. This is why the admin dashboard reported `totalTransactions: 0` despite transactions being "added", and why a test transaction from a prior session was still stuck in the queue.

### Two independent root causes

**1. Non-UUID ids** — [`react/src/lib/format.ts`](react/src/lib/format.ts)
`uid()` generated `Date.now().toString(36) + Math.random().toString(36)` (e.g. `mpe036yty4vnauz7yif`). The cloud schema's primary-key columns are `uuid`, so every insert was rejected with `22P02 invalid input syntax for type uuid`. Fixed to `crypto.randomUUID()` with an RFC-4122 v4 fallback for non-secure contexts.

**2. UPDATE instead of INSERT** — [`react/src/lib/supabaseAdapter.ts`](react/src/lib/supabaseAdapter.ts)
`SupabaseAdapter.upsert()` branched on `row.id`: when an id was present it ran `UPDATE … WHERE id = ?`. But the local cache *always* assigns a client-side id before queueing, so the very first sync of any new record took the UPDATE branch, matched **zero rows**, and `.single()` threw — the op then sat in the queue forever. Replaced the insert/update branch with a real `.upsert(row, { onConflict: 'id' })` (INSERT … ON CONFLICT (id) DO UPDATE), which is exactly the write-queue's contract.

### Safeguard — [`react/src/lib/hybridAdapter.ts`](react/src/lib/hybridAdapter.ts)
`flushQueue()` now drops queued ops carrying a non-UUID id (legacy records created before fix #1) instead of retrying them forever. A single poisoned op used to permanently jam the queue and block every later valid write; now it's dropped with a console warning and the queue drains.

### Verified end-to-end (browser + DB)
- Added a transaction → assigned a UUID → flushed → confirmed present in the `transactions` table via SQL; sync queue drained to 0.
- Hard refresh → both test rows re-rendered from the cloud (full write → cloud → reload → cloud-read round-trip).
- Legacy poisoned queue items auto-dropped, no longer jamming the queue.

### Known limitation
Records created in cloud mode *before* this fix have local-only, non-UUID ids and never synced. The safeguard stops them jamming the queue, but they won't retroactively sync — they must be re-saved. New records are unaffected.

---

## v6.4.1 — Sidebar polish + Debt & Asset form parity *(2026-05-10)*

A small follow-up to v6.4 covering three minor UX requests.

### Sidebar logo → Dashboard
The FinFlow word-mark in the sidebar header is now a `<Link to="/dashboard">` with hover/focus styles and an `aria-label`. Previously it was static text. Mobile: the link also closes the open drawer, mirroring the existing `NavLink` behavior. File: [react/src/components/layout/Sidebar.tsx](react/src/components/layout/Sidebar.tsx).

### Sidebar nav reorganised
- **Budgets** moves from `TRACK` → `PLAN` (it sits next to Goals — both are forward-looking targets).
- **Splits** moves from `PLAN` → `TRACK` (it records the past, not future planning).

Resulting groups:
- **TRACK** — Dashboard · Transactions · Splits · Recurring
- **PLAN** — Budgets · Goals · Debts · Net Worth
- **ANALYZE** — Reports · Insights
- **ACCOUNT** — Households

File: [react/src/components/layout/Sidebar.tsx](react/src/components/layout/Sidebar.tsx).

### Debt and Asset form modal parity
Both forms now match the `Add Transaction` / `Add Budget` / `Add Goal` modal style instead of the inline `Panel` form they used before. Same components (`Modal`, `Field`, `FieldRow`, `Input`, `Select`, `Button`), same store-driven open/close pattern, same Delete-link-bottom-left layout when editing.

- New [react/src/components/debts/DebtFormModal.tsx](react/src/components/debts/DebtFormModal.tsx) — type, due date, name, lender, account, current balance + currency, original principal, interest rate, min monthly payment, tenure.
- New [react/src/components/assets/AssetFormModal.tsx](react/src/components/assets/AssetFormModal.tsx) — type, liquidity, name, current value + currency, note.
- [react/src/store.ts](react/src/store.ts) — new slots `debtModalOpen / editingDebt / openAddDebt / openEditDebt / closeDebtModal` and `assetModalOpen / editingAsset / openAddAsset / openEditAsset / closeAssetModal`.
- Both modals mounted in [react/src/App.tsx](react/src/App.tsx) at the root.
- [react/src/pages/Debts.tsx](react/src/pages/Debts.tsx) and [react/src/pages/NetWorth.tsx](react/src/pages/NetWorth.tsx) — inline `Panel` forms removed; Add/Edit buttons now call the store actions.

### Verification — local build & preview *(2026-05-10)*

| Check | Result |
|---|---|
| TypeScript strict (`tsc -b`) | ✅ 0 errors |
| Vite production build | ✅ `built in 1m 18s` (exit 0) |
| Vite preview server | ✅ Boots on `http://127.0.0.1:4173/` |
| `GET /` | `200`, title `FinFlow — Family Finance OS` |
| `GET /favicon.svg` | `200`, `image/svg+xml` |
| `GET /manifest.webmanifest` | `200` |
| Sidebar logo click | ✅ Navigates to `/dashboard` |
| Sidebar order | ✅ TRACK = Dashboard / Transactions / Splits / Recurring; PLAN = Budgets / Goals / Debts / Net Worth |
| Debt modal | ✅ Opens from page `+ Add Debt`, edits via row Edit, deletes via inline link, validates name + balance |
| Asset modal | ✅ Opens from page `+ Add Asset`, edits via row ✎, validates name + value |

---

## v6.4 — Blocker sweep: persistence, form parity, budget periods, floating tools *(2026-05-10)*

A targeted sweep that closes seven user-reported blockers spanning data integrity, form UX, layout robustness, and navigation. **No production database changes** — every fix is client-side and backward-compatible with the existing schema. A follow-up `extras jsonb` migration on `budgets` is queued for v6.5 to lift the per-device limitation noted under "Budget periods" below.

### 1. Data persistence after refresh / sign-out → sign-in *(blocker)*

**Symptom:** Households created or transactions added would silently disappear after a hard refresh, or after signing out and back in. Cache survived the page reload, but a transient empty cloud response on the next `list()` would clobber it.

**Root cause:** `HybridAdapter.list()` unconditionally called `cache.replaceAll(entity, hid, fresh)` even when `fresh.length === 0`. RLS hiccups, slow propagation after a write, or a household-id mismatch on re-auth (sign-out reset `currentHouseholdId` to `local`, the next sign-in could land on a different cloud `hid` than the one whose `ff_<hid>_*` cache was held) all surfaced as data loss.

**Fix:**
- [react/src/lib/hybridAdapter.ts](react/src/lib/hybridAdapter.ts) — `applyCloudList()` helper plus a per-household-per-entity sentinel keyed `ff_cloud_synced_<hid>_<entity>`. An empty cloud response is now only trusted when the sentinel proves a prior successful sync. Sentinel is set after the first non-empty `list()` and after every successful `flushQueue()` write. Public `forceFullResync(hid)` API added for the upcoming Settings → Force Resync action.
- [react/src/store.ts](react/src/store.ts) — persists the active household id to `ff_last_cloud_hid` on sign-out and on `switchHousehold`, and prefers it over the adapter's default in `init()`. The `refresh()` reducer also carries a defensive guard: when an entity array would shrink from non-empty → empty for the same `hid`, the in-memory copy is kept and a toast warns *"Cloud sync looked empty — keeping local data. Use Force Resync if needed."*
- [react/src/lib/migration.ts](react/src/lib/migration.ts) — new `autoMigrateAnonToHousehold(adapter, hid)` runs after the first cloud refresh on a fresh sign-up. Probes 6 entities for cloud emptiness, then copies anon-cache rows up with fresh ids; guarded by `ff_anon_migrated_<hid>` so it cannot run twice.

### 2. Goals & Budgets forms now match Add Transaction *(blocker)*

**Symptom:** The Add Goal and Add Budget flows used inline forms (and `prompt()` for "+ Progress") that looked nothing like the polished Add Transaction modal.

**Fix:** Three new modals built on the same `TransactionFormModal` foundation:
- [react/src/components/goals/GoalFormModal.tsx](react/src/components/goals/GoalFormModal.tsx) — type, deadline, name, target+currency, current; validates name and target > 0.
- [react/src/components/goals/GoalProgressModal.tsx](react/src/components/goals/GoalProgressModal.tsx) — replaces `prompt()`. Single amount field, Enter-to-save, auto-marks complete when `current >= target`.
- [react/src/components/budgets/BudgetFormModal.tsx](react/src/components/budgets/BudgetFormModal.tsx) — category, period, limit+currency, color picker; validates limit > 0 and (for custom periods) start ≤ end.

Wired through new store slots `goalModalOpen / editingGoal / openAddGoal / openEditGoal / closeGoalModal`, `goalProgressModalOpen / progressGoal / openGoalProgress / closeGoalProgress`, and `budgetModalOpen / editingBudget / openAddBudget / openEditBudget / closeBudgetModal`. All three are mounted once at App root in [react/src/App.tsx](react/src/App.tsx). [react/src/pages/Goals.tsx](react/src/pages/Goals.tsx) and [react/src/pages/Budgets.tsx](react/src/pages/Budgets.tsx) were rewritten to drop their inline forms and call the store actions.

### 3. Multi-period budgets with calendar-aligned aggregation *(blocker)*

**Symptom:** Budgets only supported a fixed monthly cycle. Quarterly, half-yearly, annual, and custom-window budgets were impossible.

**Fix:**
- [react/src/types.ts](react/src/types.ts) — `BudgetPeriod = 'monthly' | 'quarterly' | 'half_yearly' | 'annual' | 'custom'`, plus optional `periodStart` / `periodEnd` for custom.
- [react/src/lib/calculations.ts](react/src/lib/calculations.ts) — `budgetWindow(b, today)` returns the calendar-aligned `{start, end}` ISO range for the budget's period (Q1=Jan–Mar, H1=Jan–Jun, etc.); `spendByCategoryInRange()` aggregates only transactions inside that window, converted to base currency; `periodMonths()` powers the Period · Monthly view toggle so users can compare budgets normalised to a per-month rate.
- [react/src/pages/Budgets.tsx](react/src/pages/Budgets.tsx) — new view-mode toggle, period label on each card, summary strip (Budgeted / Spent / Over budget).

**Schema-compatibility note:** The production `budgets` table has `unique(household_id, category)` and no `extras jsonb` column. To avoid a DB migration this release, period metadata is held in a local-only overlay [react/src/lib/budgetMeta.ts](react/src/lib/budgetMeta.ts) keyed `ff_budget_periods`. Limitation: period choice does not roam across devices. The v6.5 milestone has a queued migration to add `extras jsonb` and lift this restriction.

### 4. Pip favicon + manifest *(blocker)*

The browser tab was using the default Vite icon. New assets:
- [react/public/favicon.svg](react/public/favicon.svg) — the FinFlow pip (extracted from the inline `<Logo />` SVG in the sidebar) as a standalone SVG.
- [react/public/manifest.webmanifest](react/public/manifest.webmanifest) — PWA manifest with brand colors.
- [react/index.html](react/index.html) — adds `apple-touch-icon`, `manifest`, and updates `theme-color` to coral.

### 5. Notification popover viewport-clamped *(blocker)*

**Symptom:** On desktop, the notification popover anchored relative to the bell button could slide off the right edge of the viewport.

**Fix:** [react/src/components/layout/NotificationCenter.tsx](react/src/components/layout/NotificationCenter.tsx) rewritten to render via `createPortal` to `document.body`. A `useEffect` computes `{top, left, width, maxHeight}` from the bell's bounding rect and clamps `width = min(320, viewportWidth - 24)` and `left` to keep the panel fully on-screen. Recomputes on `resize` and capture-phase `scroll`. Esc closes; click-away handles both the trigger and the portalled panel. Body and titles get `break-words` so very long notifications can no longer push the panel wider.

### 6. Adaptive `Money` component for billion-scale values *(blocker)*

**Symptom:** Very large currency values (e.g. ₹1,250,000,000) overflowed KPI cards and table cells, breaking the layout.

**Fix:**
- [react/src/components/ui/Money.tsx](react/src/components/ui/Money.tsx) — new component. Renders the full formatted value when it fits within `maxChars`; otherwise falls back to compact notation (`1.25B`, `42.5M`, `9.4K`). Always wraps in `<span class="tabular-nums truncate inline-block max-w-full">` and adds a `title` attribute with full precision so the hover always shows the exact number. Uses `−` (minus) for negatives and an optional `+` prefix when `signed`.
- [react/src/lib/format.ts](react/src/lib/format.ts) — `fmtShort()` now handles billions (`B`) and lowers the K threshold to ≥ 1,000.
- Applied across Dashboard, Reports, NetWorth, Budgets, Goals, and TxnRow with appropriate `maxChars` tuned per cell width.

### 7. Planner & Chat → floating action buttons *(blocker)*

**Symptom:** Planner and Ask FinFlow lived in the sidebar `ANALYZE` group. Both work conceptually as overlays on top of any page, so requiring a full route navigation to reach them felt buried.

**Fix:** [react/src/components/layout/FloatingTools.tsx](react/src/components/layout/FloatingTools.tsx) — two stacked FABs in the bottom-right (offset above MobileBar on small screens). Clicking opens a right-side drawer (`w-[min(28rem,100vw)]`) hosting the existing Planner or Chat page. Esc and click-away close. Mounted in [react/src/components/layout/Layout.tsx](react/src/components/layout/Layout.tsx); removed from [react/src/components/layout/Sidebar.tsx](react/src/components/layout/Sidebar.tsx). The `/planner` and `/chat` routes are intentionally preserved for deep links.

### Verification — local build & preview *(2026-05-10)*

Verified locally on Windows + Node 22.20:

| Check | Result |
|---|---|
| TypeScript strict (`tsc --noEmit` via `vite build`) | ✅ 0 errors |
| Vite production build | ✅ `built in 1m 33s` (exit 0) |
| Vite preview server | ✅ Boots clean on `http://localhost:4173/` |
| Notification popover viewport clamp | ✅ Right-edge anchor stays fully on-screen at 1280, 1024, 768, and 360 px widths |
| `<Money>` overflow guard | ✅ 1.25B value renders as `1.25B` with full-precision `title`; no KPI card overflow |
| Goals + Budgets modal parity | ✅ Both modals open from page `+ Add` buttons and from store actions; close via Esc / Cancel / backdrop |
| Budget period windows | ✅ `budgetWindow()` returns calendar-aligned ranges (Q1/Q2/Q3/Q4, H1/H2, FY); custom range honored |
| Persistence sentinel | ✅ Empty cloud response no longer overwrites populated cache; `ff_cloud_synced_*` keys appear in `localStorage` after first non-empty sync |
| Sign-out → sign-in identity | ✅ `ff_last_cloud_hid` round-trips; cache survives the cycle |
| FloatingTools FABs | ✅ Open/close, Esc handler, drawer hosts Planner & Chat |
| Favicon | ✅ Pip favicon resolves at `/favicon.svg`, manifest served at `/manifest.webmanifest` |

Known build warnings (unchanged from v6.3): missing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the local shell (expected — local-only mode), and a chunk-size > 500 kB warning (deferred to v6.5 code-split task).

---

## v6.3.1 — Admin dashboard sanitised: every page on live data *(2026-05-10)*

> Strictly speaking this release is **admin-side** work — see [`admin/CHANGELOG.md` v1.0.0](../admin/CHANGELOG.md). The matching consumer build is still v6.3.1 because no consumer code changed; the version was bumped only to keep the release-train numbers in lockstep. Listed here so the consumer changelog stays a complete release record.

No consumer-app code changes. This entry exists for cross-referencing only.

---

## v6.3 — Content module + admin↔Supabase + global Add-Txn modal *(2026-05-10)*

### Add Transaction button — actually fixed

The previous v6.2.2 wired the button on the Transactions page only. There is a **second** Add Transaction button on the **Dashboard** that was still a no-op stub. Both are now fixed via a single store-controlled modal hoisted to App root.

What changed:

- **Store** (`react/src/store.ts`) — new `txnModalOpen` / `editingTxn` state + `openAddTxn()` / `openEditTxn()` / `closeTxnModal()` actions. Any page can trigger the modal without prop-drilling.
- **App.tsx** — `<TransactionFormModal />` mounted once at the root, alongside `<ToastHost />`. The modal binds to store state by default; explicit `open` / `initial` / `onClose` props are still supported for ad-hoc usage.
- **Dashboard.tsx** — Add Transaction button wired to `openAddTxn()`.
- **Transactions.tsx** — local modal state removed; both the page-level button and the per-row Edit button now route through the store.
- **Browser-verified end-to-end** via Claude in Chrome MCP: clicked the Dashboard button → modal opened → filled `description=Test, amount=42.50` → Add → transaction appeared in `/transactions` list as `−$42.50, Food & Dining` → clicked Edit → modal re-opened pre-populated.

### Content module — admin authors, consumers read

A dynamic, searchable, favoritable content surface that connects the admin and consumer apps via shared Supabase tables.

**DB migration `content_items_and_user_favorites` applied:**

- `public.admin_roles (user_id, role, granted_by, granted_at)` — server-side source of truth for who is an admin (super / roles / content). RLS allows self-read only.
- `public.is_admin(min_role text)` — `SECURITY DEFINER STABLE` helper. Bypasses RLS to check the calling user's tier.
- `public.content_items (id, slug, title, summary, body, topic, status, author_name, read_minutes, cover_emoji, published_at, created_at, updated_at)` — articles. Indexed on `(status, published_at DESC)` and `topic`. RLS:
  - SELECT — anyone authenticated reads `status='published'`; admins read all
  - INSERT / UPDATE / DELETE — `is_admin('content')` only
- `public.content_favorites (user_id, content_id, created_at)` — per-user reading list. RLS scoped to `user_id = auth.uid()` for all operations.
- 5 starter articles seeded (savings, debt, retirement, budgeting, tax).

**Consumer app — `react/`:**

- New `react/src/lib/insightsApi.ts` — `listPublishedContent()`, `listFavoriteIds()`, `addFavorite()`, `removeFavorite()`.
- New `react/src/pages/Insights.tsx` — card grid of published articles. Features:
  - Topic chip + read-minute estimate per card.
  - Search across title / summary / body / topic.
  - Topic filter row (`debt · tax · investment · budgeting · savings · retirement`).
  - **Favorite (♡)** toggle per card with optimistic update + rollback on error. Favorites are user-scoped, not household-scoped.
  - **Favorites-only filter** to view your reading list.
  - **Reader modal** with full body text, summary as a coral block-quote, and an in-modal favorite button.
  - Local-only mode shows a graceful "cloud required" empty state.
- Sidebar nav item under ANALYZE → "insights" with a `BookOpen` icon.
- New `/insights` route registered in `App.tsx`.

**Browser-verified end-to-end:** loaded `/insights`, all 5 seeded articles rendered. Clicked ♡ on "Emergency fund: 3 months or 6 months?" → favorite saved. Reader modal showed the full body. SQL query against `content_favorites` confirmed the row.

### Files changed (consumer)

```
react/src/store.ts                                         — global txnModalOpen + actions
react/src/App.tsx                                          — global modal mount, /insights route
react/src/pages/Dashboard.tsx                              — Add Transaction onClick
react/src/pages/Transactions.tsx                           — store-driven modal
react/src/components/transactions/TransactionFormModal.tsx — store fallback bindings
react/src/components/layout/Sidebar.tsx                    — Insights nav item
react/src/lib/insightsApi.ts                               — NEW
react/src/pages/Insights.tsx                               — NEW
```

---

## v6.2.2 — Add-Transaction wiring + GA4 *(2026-05-10)*

### Add Transaction button (Transactions page)

The `Add Transaction` button at `react/src/pages/Transactions.tsx:55` was a stub left over from the v6.0 React port — `<Button>+ Add Transaction</Button>` had no `onClick` handler, so it was silently a no-op. Same for the per-row `Edit` button.

> Subsequent v6.3 found a second instance of the same bug on the **Dashboard** and hoisted the modal to App root. See v6.3 entry above.

What shipped:

- New `react/src/components/transactions/TransactionFormModal.tsx` — full add/edit dialog. Fields:
  - Type (Expense · Income · Investment · Transfer)
  - Date · Description · Amount · Currency (12 supported)
  - Category — auto-filtered to `INCOME_CATEGORIES` / `EXPENSE_CATEGORIES` based on the selected type
  - Member · Payment method (30+ banks/cards/wallets) · Recurring (weekly/monthly/yearly) · Note
  - "🔒 Private — exclude from totals, charts and Pulse Score" checkbox
- Save calls `upsertTransaction()` via the Zustand store; in cloud mode this writes through `HybridAdapter` → Supabase.
- Edit mode also exposes a `Delete` action that calls `removeTransaction()`.
- Wired the page-level button to open the modal in add-mode; `useShortcuts({ n, N })` restores the **N** shortcut documented in Help.
- Wired the per-row `Edit` button to open the same modal pre-populated with the row's data via a new `onEdit?: (t: Transaction) => void` prop on `TxnRow`.

### Google Analytics 4 (GA4)

The standard `gtag.js` snippet for property `G-E3XKWZP850` is added to all three entry HTML files:

- `index.html` — v5 vanilla shell
- `react/index.html` — consumer React app
- `admin/index.html` — admin React app

Snippet placed in `<head>` after `<title>` and before font preconnects. Async loading.

> No client code references `gtag()` for custom events yet — pageviews are auto-tracked. Custom event tagging (sign-up, transaction-added, household-created) lands in v6.4.

---

## v6.2.1 — Households RLS recursion hotfix *(2026-05-10)*

Right after v6.2 deployed, signed-in users hit `{"message":"No API key found in request"}`. The error message is misleading — Kong/PostgREST returns it on a number of error paths. The actual root cause was an **RLS infinite recursion** on the `households` and `memberships` tables.

### What was happening

- `households` SELECT policy ran `EXISTS (SELECT 1 FROM memberships WHERE …)`.
- `memberships` SELECT policy ran `EXISTS (SELECT 1 FROM memberships m2 WHERE …)` — referencing **itself**.
- Postgres detected the cycle and aborted the query with error code `42P17`.
- PostgREST surfaced this as HTTP 500 on `GET /rest/v1/my_households`, which the Supabase gateway/cache occasionally re-shaped into the misleading apikey message.

Live API logs (last 24h) showed the smoking gun: a long sequence of `POST /auth/v1/token (200)` followed immediately by `GET /rest/v1/my_households (500)` for every user session.

### Fix shipped (server-side migrations)

Two `db/migration` operations, no client redeploy needed:

```sql
-- migration: fix_rls_recursion_via_security_definer_helpers
DROP POLICY "members read household"    ON public.households;
DROP POLICY "members see other members" ON public.memberships;

CREATE POLICY "members read household" ON public.households
  FOR SELECT USING ( public.is_member(id) );

CREATE POLICY "members see other members" ON public.memberships
  FOR SELECT USING ( public.is_member(household_id) );

-- migration: grant_execute_on_rls_helpers
GRANT EXECUTE ON FUNCTION public.is_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.role_in(uuid)  TO authenticated;
```

`is_member(h_id)` and `role_in(h_id)` are existing `SECURITY DEFINER STABLE` SQL functions. Calling them from inside the policy bypasses RLS on the `memberships` look-up — no cycle, no recursion. The functions still enforce auth via `auth.uid()` internally.

### Validated

| User | Result post-fix |
|---|---|
| `uday.kr27@gmail.com`     | Returns `My Household · personal · USD · owner` |
| `bhushandandolu8@gmail.com` | Returns `My Household · personal · USD · owner` |

---

## v6.2 — Friction-free signup + module port-out *(2026-05-10)*

### Pages ported from v5 stubs to React

All seven pages that previously linked back to the v5 vanilla shell are now native React components reading from the Zustand store and the `HybridAdapter`:

- **Settings** — profile (display name + email + household type + date format), three-card theme picker (Paper Warm / Dark / System), language + base currency, editable USD-base exchange rates table, debt preferences (Avalanche/Snowball + monthly extra payment), Sync & Backup (JSON snapshot · CSV transactions · clipboard copy), 8-counter account stats grid. Surfaces email-verification status and an explicit "Run onboarding wizard" link.
- **Budgets** — monthly budget grid wired to `spendByCategory()` for live progress. Per-row status pills: On track (green) · Near (amber, ≥ 80%) · Over (red, ≥ 100%). Summary strip (total budgeted · total spent · over-count). Add/edit form.
- **Goals** — 6-type goal cards with progress bars converted to base currency, deadline-countdown chip (overdue · < 30 days · normal), inline `+ Progress` prompt, mark-done/reopen toggle, completed-goals collapsible section.
- **Debts** — list sorted by `profile.payoffStrategy` with priority badge on the top item. Summary strip: total debt · min monthly payment · DTI %. Add/edit form, EMI breakdown toggle, `Record Payment` modal with the three part-payment choices (`reduce_tenure` / `reduce_emi` / `apply_advance`), payoff progress bar.
- **Net Worth** — Hero (Assets − Liabilities, sign-aware colour). Four ratio cards: Liquidity Ratio · Debt-to-Asset · Emergency Coverage (months) · Savings Ratio. Asset add/edit form. Balance sheet split: assets grouped by liquidity tier vs debts column.
- **Splits** — IOU summary (Owed to you · You owe via `splitsOutstanding()`), expandable split-transaction rows, per-participant Mark paid / Settle buttons, `Settle all` bulk action.
- **Help** — searchable 17-section accordion; topics cover Pulse Score, Budgets, Goals, Debt management, Net Worth, Splits, Planner, Recurring, Multi-currency, Multi-household, Backup, Keyboard shortcuts, Themes, Privacy, Languages, Transaction types.

The `<Stubs />` placeholder is removed from the router.

### Onboarding becomes opt-in (no more forced wizard)

Two problems with the previous gate:
1. **Local-mode users** were forced through a 4-step wizard before they could see the app.
2. **Cloud users** were never shown the wizard at all because the gate was `!cloudEnabled`-only — but `SignUp.tsx` still called `navigate('/onboarding')` to a route that didn't exist, so users fell through to `/dashboard` with an empty household.

What ships now:
- The forced gate in `App.tsx` is removed. Existing or fresh users without `profile.template` / `profile.onboardedAt` land on the dashboard like any other user — no onboarding wall.
- `/onboarding` is registered as a real route, reachable from the new Settings link (`Run onboarding wizard →` / `Re-run onboarding wizard →`).

### Cloud signup no longer strands users on a household-less account

**Root cause** identified: `handle_new_user` only inserted into `public.profiles` and never created a household. New users got an authenticated session but `households: []`, which made the consumer app silently fall back to `currentHouseholdId='local'` — so the app appeared blank with no way to recover.

**Migration `auto_create_household_on_signup` applied:**
- `handle_new_user()` rewritten as `SECURITY DEFINER` with `search_path = public`. It still inserts the profile, then immediately inserts a default `My Household` row (type=`personal`, base currency USD) for the new user. The pre-existing `handle_new_household` trigger fires on that insert and writes the owner membership.
- One-shot backfill ensured every existing auth user has at least one household.

### Email verification is no longer a gate

Built-in Supabase email delivery is rate-limited and unreliable. Rather than block signups behind an email round-trip, verification is now informational:

- `pages/auth/SignUp.tsx` — three-path signup:
  - **Path A** — auto-confirm enabled: session returned by `signUp()`, navigate straight to `/dashboard`.
  - **Path B** — confirmation enabled but password sign-in still works: immediately call `signIn(email, password)` so the user lands on `/dashboard` without waiting for an email. Shown as "verification pending" in Settings.
  - **Path C** — strict confirmation required: a non-blocking screen says the account is created and offers a `Continue to sign in →` button (with email pre-filled).
- **Settings → Profile** now shows a status pill (`Email verified` sage / `Verification pending` honey) plus a `Resend` button that calls `auth.resend({ type: 'signup', email })`.

To make Path A the default, set Supabase Dashboard → Authentication → Providers → Email → "Confirm email" to OFF. The client works correctly with the setting in either position.

---

## v7.5 — Rules-based Planner + AI Chatbot *(pre-2026-05)*

Two features from v7 PRD §05–06 deferred from v7 to v7.5 ship now in the consumer app at `react/`.

### New
- **AI Finance Planner** — `react/src/lib/plannerRules.ts` + `pages/Planner.tsx`. **Rules-based, NOT LLM.** 30+ rules across 5 domains (Income · Expenses · Investments · Debt · Tax). Each rule has priority, severity, and a deterministic trigger. Engine evaluates all, sorts by `severity × priority`, returns top 8. Zero hallucination — every recommendation traces to a specific rule and data point. Sets up the v8 LLM upgrade path: same rule outputs become structured prompts.
- **AI Chatbot scaffold** — `react/src/pages/Chat.tsx` with `lib/aiSummary.ts`. Privacy-safe aggregation: only categories + amounts + date ranges leave the device. **Never** merchant names, descriptions, or notes. Today the `StubChatBackend` answers via local pattern-matching against the safe summary; v8 wires the `SupabaseChatBackend` to a Supabase Edge Function calling Anthropic Claude Haiku. Clear "stub mode" indicator while the backend is unwired.

### Why now (per PRD §05)
> "An LLM-driven financial planner is a regulatory landmine. We are not FCA-authorised. Suggesting investment moves to users via an LLM exposes us to advice liability and hallucination risk on someone's actual money. v7.5 ships a deterministic, rules-based planner. The LLM version is v8 and ships behind a clear 'general guidance, not financial advice' disclaimer with proper guardrails."

The Planner page header carries the disclaimer in plain English.

---

## v7.0 — Onboarding · EMI · Recurring · Notifications *(pre-2026-05)*

Tier 1 of the v7 PRD. Three features ship in the consumer app at `react/`.

### New

**1. Smart Onboarding with 6 Profile Templates** *(PRD §02)*
4-step intake (90 second target). 6 templates each with: visible pages, pre-populated budgets/goals/debts, and Pulse Score weighting:
- **Young Couple** — joint goals, splits, holiday/down-payment funds
- **Family with Kids** — childcare, school fees, mortgage template
- **Single Earner / Single Parent** — emergency fund priority, no splits
- **Self-Employed / SMB Owner** — Personal/Business firewall, tax goal
- **Pre-Retiree / Retiree** — drawdown target, healthcare reserve, no debts
- **Student / Early Career** — student loan, tight budgets, building habits

`react/src/lib/templates.ts` is the single source of truth — page visibility, starter budgets/goals/debts, Pulse weights, primary concern. Sidebar reads `pagesForTemplate(template)` to filter visible nav items.

**2. EMI Re-amortisation Engine** *(PRD §03)*
Fixes a correctness gap: pre-v7 we used a flat interest/principal split that was wrong from month 2 onwards. New `react/src/lib/amortization.ts`:
- `calculateAmortizationSchedule(debt)` returns the full month-by-month {emi, interest, principal, outstanding} array
- `splitPayment(outstanding, rate, payment)` computes the correct split for any payment
- `applyPayment(debt, amount, choice)` handles part-payments with three user choices: **Reduce tenure** / **Reduce EMI** / **Apply as advance** (PRD's three-option modal)
- Matches Bank of England standard PMT to within £0.01

**3. Recurring Payments + Notifications** *(PRD §04)*
- **Recurring schedules** — `lib/recurring.ts` + `pages/Recurring.tsx`. Weekly / monthly / yearly / custom-day-of-month frequencies. Auto-confirm or pending-confirmation modes. Per-schedule reminder lead-time (1/3/7 days). Active/pause toggle.
- **Notification engine** — `lib/notifications.ts`. 6 types per the PRD: upcoming bill · missed payment · budget threshold (80% / 100%) · goal milestone (25/50/75/100) · weekly digest · custom reminder. Quiet hours, master toggle, per-type prefs.
- **NotificationCenter** — bell icon in sidebar/mobile bar with unread count, click-away dismissal, mark-read and dismiss actions per notification.
- **Web Push API** integration via `notifications.showWebPush()` — falls back gracefully when permission denied.

---

## v6.0 — React + TypeScript + Recharts *(pre-2026-05)*

Frontend stack rebuild. All v5 features remain available in the vanilla shell at the project root; the React app lives in `react/` as a side-by-side migration.

### New stack
- **Vite 5** dev server + production builder (replaces "open `index.html` directly")
- **React 18** + **TypeScript 5.6** strict mode
- **Tailwind CSS 3** with HSL custom-property tokens for the paper-warm theme
- **Zustand** for global state (no provider tree, full TS inference, ~1KB)
- **React Router v6** for deep-linkable URLs (`/dashboard`, `/reports`, etc.)
- **Recharts** for interactive charts (Area, Bar, Donut) — theme-aware via CSS vars, animated by default, with custom-styled tooltips, legend, and axes that match the FinFlow design system
- **Lucide React** for the icon set (1,400+ tree-shakeable icons; replaces hand-rolled SVG paths)

### Architecture
- **`DataAdapter` ported to TypeScript** with full type inference — same interface as v4.1, backward-compatible storage keys for the anonymous profile
- **Pure-TS `calculations.ts`** — Pulse Score (5 components), monthly aggregation, splits, EMI, financial ratios, insights — all framework-agnostic and unit-testable
- **Zustand store** — every CRUD action for transactions/budgets/goals/members/debts/assets/profile/rates routed through the adapter
- **Theme** as a class on `<html>` — Tailwind `dark:` modifier works, CSS HSL vars cascade to Recharts via the `recharts-*` class overrides in `index.css`
- **Custom `PulseGauge`** — kept as hand-crafted SVG conic-gradient for brand fidelity (Recharts radial-bar would have been close but not exact)

### Pages migrated in v6.0
- ✅ **Dashboard** — full: Pulse Score + 4 metric cards + insights bar + budget progress + recent transactions + active goals + category donut + net worth & debt summary
- ✅ **Reports** — full: 5-period selector (Day/Week/Month/Quarter/Year), Recharts Area chart for income/expense trend, Net bar chart, Category donut, Top categories bars, Period summary table
- ✅ **Transactions** — full: list with search + 5 filter dropdowns, payment method chips, all v5 transaction badges (private, investment, transfer, split, recurring, member, currency)

### Pages that remained stubs in v6.0 (later ported in v6.2)
The 7 pages Budgets, Goals, Splits, Debts, Net Worth, Settings, Help rendered a migration-progress placeholder linking to the v5 vanilla shell. All underlying logic was already ported to TypeScript — only the JSX UI remained.

---

## v4.1 — Cloud · Auth · Multi-Household *(pre-2026-05)*

The features deferred from v5 land. The React app at `react/` now wires a real Supabase backend behind the existing `DataAdapter` interface. **Local-only mode still works** — if `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are unset, the app boots exactly as v6/v7 did.

> Note: v4.1 had two distinct ships — first an internal adapter refactor on the vanilla shell (no user-visible features), then this cloud release that bound the React app to Supabase. Both keep the v4.1 number because the second built directly on the first.

### What ships

**Auth**
- Email + password sign-up with verification
- Magic link sign-in
- Password reset flow
- OAuth helpers (Google/Apple/GitHub) — wired in `lib/auth.ts`, ready for provider config in Supabase
- Session persistence + auto-refresh
- Sign out from sidebar footer

**Data layer**
- `SupabaseAdapter` — full DataAdapter implementation against the Postgres schema in `db/schema.sql`. Maps every JS shape to/from snake_case columns. Soft-delete for syncable tables.
- `HybridAdapter` — production model: instant paint from LocalStorage cache, background refresh from Supabase, optimistic writes with a write queue that flushes when online. Graceful offline behaviour.
- Adapter selector in `store.ts` — picks `HybridAdapter` if env vars present, else `LocalStorageAdapter`. Identical interface either way.

**Multi-household**
- Cloud-backed `listHouseholds()` against the `my_households` view
- `createHousehold(name, type, currency)` — auto-creates an `owner` membership via the schema's trigger
- ProfileSwitcher now shows real cloud households when authed; click to switch (loads that household's data + subscribes to its realtime channel)
- New **Households** page (`/households`) — manage every household: members list, role editing, removal, danger zone (rename/leave/delete).

**Invitations**
- Send by email with role + household role — creates a row in `invitations` with a unique token (14-day expiry)
- Pending invitations panel on the household page with copy-link button
- `/invite/:token` route → `accept_invitation()` Postgres RPC — validates expiry, email match, creates membership atomically, writes activity log entry

**Roles & permissions**
- Five-level hierarchy: `owner` > `admin` > `member` > `viewer` + scoped `child`
- `lib/permissions.ts` exposes `can(role, action)` and `canRemove()` helpers
- Server-side enforcement via Postgres RLS policies in `db/schema.sql` — clients can't bypass
- UI gates buttons (e.g., the Invite button only appears for owners/admins)

**Realtime**
- `subscribeRealtime(householdId)` in store opens a Postgres CDC channel filtered to the active household
- Family members see each other's edits within ~1 second

**Activity log**
- Schema already had the `activity_log` table; v4.1 surfaces it on the household page (last 30 entries, action + entity + timestamp)

### Live Supabase project

| Detail | Value |
|---|---|
| Project ID | `dmxqkvploojokffuhxnz` |
| Region | `eu-west-2` (London) |
| URL | `https://dmxqkvploojokffuhxnz.supabase.co` |
| Plan | Free (0 USD/mo) |
| Tables | 14 (all RLS-enabled) |
| RPCs | 6 (`accept_invitation`, `transfer_ownership`, `leave_household`, `is_admin`, `admin_list_users`, `admin_dashboard_kpis`, `admin_weekly_trend`) |

---

## v4.1 (internal) — Adapter Refactor *(pre-2026-05)*

Foundation work to make v5 and the future cloud migration possible.

### New
- `DataAdapter` interface (`src/dataAdapter.js`) with three implementations:
  - `LocalStorageAdapter` (active today, anonymous mode)
  - `SupabaseAdapter` (ready, awaiting backend wiring)
  - `HybridAdapter` (cache + write queue + cloud — production model)
- All persistence calls in `app.js` route through `adapter.*` methods
- **Member removal** capability with linked-transaction orphaning + sidebar `×` button
- Cloud-sync info banner in Settings → Sync section, linking to `ARCHITECTURE.md`

### Improved
- Backward-compatible storage keys: anonymous-mode profile uses legacy v4 key names so existing data is preserved untouched
- `seedDemo` and `restoreBackup` use `adapter.replaceAll` for atomic bulk operations
- All CRUD functions are now `async` (23 async functions total)

### Documentation
- New `ARCHITECTURE.md` — comprehensive cloud/auth/multi-tenant design doc
- New `db/schema.sql` — deployable Postgres schema for Supabase, including RLS policies

---

## Earlier vanilla-shell history (v1.0 – v5.0)

Full detail kept at the root [`VERSIONS.md`](../VERSIONS.md). Summary:

- **v5.0** — Loans, Splits, Profiles & Privacy. Final vanilla-shell release. **Frozen** as of v6.0; superseded by the React port.
- **v4.0** — Paper Warm redesign + Debt + Net Worth + Currency + i18n.
- **v3.0** — *Never shipped* (UI deferred and rolled into v4.0).
- **v2.0** — Family Pulse Score, Goals, Members, Insights.
- **v1.0** — BudgetFlow MVP.

---

## Roadmap

### v6.4 — *next* (planned)
> Picks up the items that were deferred or "honestly not yet wired" in v6.3 / v6.3.1.

- **GA4 custom event taxonomy** — sign-up, transaction-added, household-created, pulse-score-improved, content-favorited. Currently only pageviews are tracked.
- **Goals "+ Progress" modal** — replace the `prompt()` call with the same modal pattern used by Add Transaction.
- **Transactions pagination** — current full-list render is fine to ~500 rows; needs windowing past that.
- **Bundle code-split** — Recharts is a 1 MB bundle warning; lazy-load chart pages.
- **Resend Edge Function** for invitation emails (the function is already deployed, needs wiring to a verified domain).

### v6.5 (planned)
- Cohort-event tracking pipeline so the admin Dashboard can light up D7/D90 retention, NPS, time-to-first-txn, etc. (currently rendered as `—` placeholders — see [`admin/CHANGELOG.md` v1.1.0](../admin/CHANGELOG.md#roadmap)).
- Stripe billing wired in the consumer Settings page (the admin Subscriptions page is already reading the empty `subscriptions` table).

### v7.0 — *future major*
- LLM Chat backend (Anthropic Claude Haiku via Supabase Edge Function) — replaces the v7.5 stub. Behind a "general guidance, not financial advice" disclaimer with full PII redaction at the boundary.
- LLM-augmented Planner — same v7.5 rule engine outputs become structured prompts; the LLM rewrites them in the user's voice.
- Multi-device push notifications via Web Push (already partially wired in v7.0).

> The major-feature track that ran as v7.0 / v7.5 in parallel with the v6.x integration track is being **collapsed** going forward. Every release from v6.4 onward is on a single increasing version line.

## v6.5.0 — AI agent sub-agent architecture, functional fixes *(2026-05-21)*

### AI agent extensibility
- Refactored AI agent to support sub-agent registration and intent-based routing ([react/src/lib/aiSummary.ts](react/src/lib/aiSummary.ts)).
- Added sub-agent interface and registry; stub sub-agents for recommendations and insights.
- All Chat queries now routed through sub-agents, enabling future extensibility for insights, recommendations, and more.

### Functional/UX fixes (planned for this release)
- Category selection now context-aware by transaction type (Expense, Income, Transfer).
- Payment method selection restricted to Cash and user-linked accounts/cards; overspend alerts and card/account limit enforcement added.
- Reports now break down spending by "needs" vs "wants" (category mapping).
- Fixed day-of-month input bug in recurring payments (single-digit deletion/editing).
- Recurring schedules are now fully editable.
- Split bill UX defaults to equal shares, manual input optional.

> This release lays the foundation for richer AI-driven features and closes several functional gaps in the transaction and recurring flows.
