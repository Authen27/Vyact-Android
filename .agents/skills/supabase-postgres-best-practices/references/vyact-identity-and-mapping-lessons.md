# Vyact addenda — identity, mappers, soft-delete (hard-won, v9.3.x budget sync)

Project-specific rules learned fixing the budget multi-device sync saga. They
generalise to any syncable entity with a uniqueness rule.

## schema-identity-in-db — enforce business identity in the database, never on the client

A row's business identity (e.g. one budget per `household, scope, period`) must be
owned by the DB: a partial unique index + an upsert that conflicts on **that** key.
Do NOT derive the client primary key from the identity to "make devices converge."

- **Incorrect:** client computes a deterministic UUID from `(household, scope, year, month)` and upserts `ON CONFLICT (id)`. Breaks two ways: (1) delete then recreate the period lands on the **soft-deleted same-id** row and never clears `deleted_at` → the row revives invisible; (2) any pre-existing/recovered row with a *different* id collides with the deterministic id on the unique index → dead-letter.
- **Correct:** DB assigns the id; identity is enforced by `uq_<entity>` partial indexes and a single `upsert_<entity>(h, b, mode)` RPC used by every entry point (UI + Ask Vyact + WhatsApp + API):
  ```sql
  -- create: reject a taken slot atomically (race-proof, sees other members' unsynced rows)
  insert into budgets (...) values (...)
  on conflict (household_id, period_year, period_month) where scope='month' and deleted_at is null
  do nothing returning * into rec;
  if rec.id is null then raise exception 'BUDGET_EXISTS' using errcode='23505'; end if;
  -- replace: idempotent set / revive (machine entry points)
  on conflict (...) do update set ..., deleted_at = null;
  ```

## data-no-explicit-null-on-notnull — mappers must omit/default NOT-NULL columns, never write explicit `null`

`budgets.period` is `NOT NULL DEFAULT 'monthly'`. A mapper wrote `period: b.period || null`;
the scope-based form never sends `period`, so every create sent `period: null` → NOT NULL
violation → optimistic write threw → dead-lettered → "create never reaches cloud."

- **Incorrect:** `period: b.period || null`  (explicit null defeats the DB default)
- **Correct:** `period: b.period || 'monthly'`, or **omit the key** so the column default applies. (supabase-js drops `undefined` keys — `?? undefined` is the safe pattern, as Vyact's `provToRow` does for `confidence`/`source`.)

## data-soft-delete-revive — `ON CONFLICT (id) DO UPDATE` onto a soft-deleted row must clear `deleted_at`

With soft-delete (`deleted_at`), an upsert that lands on a tombstoned row revives its data
but leaves it dead unless you explicitly reset the flag. Always `set ..., deleted_at = null`
in the DO UPDATE for a write that is meant to produce a LIVE row.

## Validation without a paid branch

Test the real RPC with an auto-rollback harness: run all scenarios in one `DO $$ ... $$`
block that ends with `raise exception 'RESULTS: %', report;` (rolls back everything; the
RAISE carries the report). Impersonate an authed member with
`set_config('request.jwt.claims', json_build_object('sub', '<member_uuid>','role','authenticated')::text, true)`
so `auth.uid()`/`is_member()` resolve. Confirm zero residue with a follow-up `count(*)`.
