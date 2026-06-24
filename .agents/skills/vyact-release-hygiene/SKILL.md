---
name: vyact-release-hygiene
description: Vyact repo conventions for releases, versioning, and documentation. Use when bumping a version, writing/updating CHANGELOG/VERSIONS/CLAUDE/README, cutting a release, or before any push to main. Encodes the drift-guard, the verify gate, the doc architecture (CLAUDE.md lean + docs/HISTORY.md archive), and the money-model gate.
license: MIT
metadata:
  author: vyact
  version: "1.0.0"
  date: 2026-06-17
  origin: TD-23 / TD-24 / TD-25 / TD-28 (TECH_DEBT.md)
---

# Vyact — release & doc hygiene

Conventions that keep the Vyact consumer app's versions consistent, its docs lean,
and its money paths safe. Apply when versioning, editing docs, or releasing.

## Versioning — the four drift-guarded surfaces

The consumer version is hand-maintained in **four** places that MUST stay in sync.
`scripts/version-drift-check.mjs` (the `version-drift` CI gate) fails the build on any
mismatch — so a version bump means editing all four, then running the guard:

1. `react/package.json` → `"version"` (the source of truth)
2. `README.md` → the Consumer row in the deliverables table
3. `VERSIONS.md` → the Consumer row in the status table **and** a newest-first timeline entry
4. `react/CHANGELOG.md` → the `Current production version` banner **and** a new `## vX.Y.Z — …` entry (newest first)

Then: `node scripts/version-drift-check.mjs` (expect "passed … consistent"). CLAUDE.md's
`current vX.Y.Z` line is also checked.

> ⚠ **Concurrent edits are common in this repo.** Before bumping, `git fetch` and check
> `git rev-list --left-right --count origin/main...main`; pick the *next* free number. A
> real collision happened once — a store refactor was mislabeled v9.4.2 while a concurrent
> customer-feedback release already owned v9.4.2, forcing a renumber to v9.4.3. Tag releases
> (`git tag -a vX.Y.Z`) only after the push succeeds; if the tag exists, you picked a taken number.

SemVer: **patch** for fixes/behaviour-neutral refactors, **minor** for a cohesive feature/
hardening body. Behaviour-neutral refactors (e.g. internal slice extraction) need **no** bump —
just say so in the commit.

## The verify gate (no browser here)

There is no live browser. "Verified" means, run via `node ./node_modules/...` (npm/npx are blocked):
`tsc -b` · `eslint` · `vitest run` · `vite build`. For anything touching money-model logic,
the vitest run already includes the **invariant + golden-regression suites**
(`moneyModel.{invariants,regression,engines}.test.ts`) — they are the gate. **If a money number
changes unexpectedly or an invariant fails, STOP** (see `vyact-money-invariants`). Validate DB
RPCs with the zero-cost **auto-rollback `DO`-block harness** (run the real function inside one block
that ends with `RAISE` → everything rolls back; impersonate an authed member via
`set_config('request.jwt.claims', …, true)`) — never a paid Supabase branch. Run `get_advisors`
after any DDL.

## Doc architecture (TD-28)

- **`CLAUDE.md` is a lean operating guide** — current state + a single **"Architecture conventions
  (binding)"** section. It carries **no dated `> Consumer vX status` narrative**
  (`grep "Consumer v.*status" CLAUDE.md` must return 0). New per-version narrative goes to
  **`react/CHANGELOG.md`** (authoritative); agent-oriented implementation detail goes to
  **`docs/HISTORY.md`** (newest-first archive). Only *timeless* rules get added to CLAUDE.md.
- **`README.md` has a "Documentation map"** table — keep new top-level docs indexed there, and keep
  links resolving.
- `TECH_DEBT.md` is the single source of truth for tech debt; record each remediation in its log.

## Commit & push discipline

- Commit/push only when asked. Stage **only** the files for the change (this repo carries unrelated
  pre-existing working-tree changes — never `git add -A` blindly).
- End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Every push to `main` deploys (Vercel). The remote is `Authen27/Vyact.git`.

## Binding product/money conventions (do-not-break)

Distilled in CLAUDE.md's conventions section; the load-bearing ones:
- **Money model is the gate** — transfers/investments are spend/income-neutral single rows;
  reconciliation is an account `reconciliation_offset` (never a transaction) bridged to the linked
  Asset/Debt for net worth; `loan_emi` is a SYSTEM_SPLIT.
- **Budget identity lives in the DB** (`upsert_budget` RPC + `uq_budget_*`) — never on the client.
- **No silent write-loss `catch {}`** — classify via `lib/faults.ts` (`expected` vs
  `unexpected`/`droppedWrite`).
- **Store is sliced** — `store/index.ts` composes `store/slices/*`; keep `useStore` byte-identical
  when refactoring.
