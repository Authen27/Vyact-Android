// Vyact v6 — Type definitions
// All data models in one place. Imported throughout the app.
//
// ── Money fields (TD-01 discipline) ─────────────────────────────
//
// Every `amount`, `limit`, `value`, `currentBalance`, `principal`,
// `minimumPayment`, `target`, `current`, `yourShare`, `share`,
// `extraPayment`, `monthly_amount`, etc. is a JS `number` in **major
// units** (dollars, euros, yen). They are always paired with an explicit
// `currency` field on the same entity (or carry the household's
// `baseCurrency` when not specified). The current/published versions
// reflect the TD-01 rollout (PR #8–#10):
//
//   • At the FX boundary  (`lib/format.ts:convert`) — exact via dinero.js
//     with banker's rounding at the target currency's native exponent.
//   • Aggregations / sums (`lib/calculations.ts`) — folded in dinero space
//     via `sumDinero` so reductions don't drift across many transactions.
//   • Amortisation / EMI (`lib/amortization.ts`) — outstanding-balance
//     chains and interest splits run through dinero in the debt's native
//     currency so a 300-row schedule doesn't accumulate per-step drift.
//   • Cloud boundary (`lib/supabaseAdapter.ts` row mappers) — every
//     money column goes through `lib/money.ts:parseMoneyFromCloud`,
//     which handles Supabase's `numeric(15,2)` string serialisation
//     defensively.
//
// A future PR may introduce a `Money` opaque type (a `number` brand) to
// move these guarantees from runtime convention into the compiler. Until
// then, the convention above is what the math layer relies on — if you
// add a new money field, route it through the same primitives.

export type TxnType = 'income' | 'expense' | 'investment' | 'transfer';
export type Recurrence = '' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Theme = 'warm' | 'dark' | 'system';
export type PayoffStrategy = 'avalanche' | 'snowball';
export type Liquidity = 'liquid' | 'short' | 'long';
export type MemberRole = 'primary' | 'partner' | 'child' | 'elder';
// W1 (owner decision, audit 2026-10-04 INT-HH-12): the 'child' app role is retired — it
// promised "own data only" but could read everything. Existing children became 'member'
// (migration 20261009120200); a stale 'child' read from an old cache is normalised by
// `normalizeAppRole` (lib/permissions.ts). The household RELATIONSHIP label 'child'
// (MemberRole above) is a separate thing and stays.
export type AppRole = 'owner' | 'admin' | 'member' | 'viewer';
export type GoalType = 'emergency' | 'savings' | 'debt' | 'investment' | 'purchase' | 'custom';
// v10.59.0 — four types (owner, 4 Oct 2026); 'shared' and 'multi_biz' retired (lib/householdTypes.ts).
export type ProfileTypeKey = 'personal' | 'couple' | 'family' | 'business';

export interface SplitParticipant {
  name: string;        // 'me' for self, otherwise free text
  isYou?: boolean;
  share: number;
  paid: boolean;
  paidOn?: string | null;
  /** v10.14 — when set (and paidBy === 'me', cloud enabled), a `shared_splits`
   *  row is created so the account at this email sees the split too. */
  email?: string;
  /** FK to the created `shared_splits.id`, once synced. */
  sharedSplitId?: string;
}

export interface SplitInfo {
  isSplit: true;
  totalAmount: number;
  yourShare: number;
  paidBy: 'me' | 'external';
  participants: SplitParticipant[];
}

// v10.14 — email-based cross-household split sharing (supabase/migrations/
// 20260724130000_shared_splits.sql). Mirrors the DB row shapes; the OWNER's
// copy is created alongside the local `Transaction.split` (display only link
// via `txnId`), the PARTICIPANT's copy is read-only except via `settleShare`.
export interface SharedSplitShare {
  id: string;
  splitId: string;
  email: string;
  /** v10.14.1 — resolved display name for `email` (via resolve_participant_names
   *  RPC), when that email has an active Vyact account. Absent = no account yet. */
  name?: string;
  share: number;
  paid: boolean;
  paidAt?: string | null;
  settledUserId?: string | null;
}

export interface SharedSplit {
  id: string;
  ownerUserId: string;
  ownerHouseholdId: string;
  txnId?: string | null;
  description: string;
  currency: string;
  totalAmount: number;
  txnType: 'expense' | 'income';
  date: string;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  shares: SharedSplitShare[];
}

// v8 — Onboarding & Activation provenance (spec §3.2). Carried on every
// baseline-derived record so honest-data rendering and the 21-day truing-up loop
// work across devices (these are real, cloud-synced columns, not a local overlay).
export type Confidence = 'estimated' | 'confirming' | 'confirmed';
// 'agent' = the row was extracted by the agent from a message/receipt (P4.5).
// It is deliberately NOT 'bank': a model-read value is not a bank-confirmed one,
// and collapsing the two would let an unverified figure render as real data.
export type ProvenanceSource = 'onboarding' | 'user' | 'bank' | 'agent';

/** Mixed onto baseline-derived entities (Transaction, Budget, Goal, Debt, Asset).
 *  Absent / 'confirmed' + 'user' means a first-class, user-owned value. */
export interface WithProvenance {
  /** Defaults to 'confirmed' for normal user/legacy rows. */
  confidence?: Confidence;
  /** Defaults to 'user'. 'onboarding' marks a setup estimate. */
  source?: ProvenanceSource;
  /** When the estimate was captured / when it became confirmed. */
  estimatedAt?: string;
  confirmedAt?: string;
}

export interface Transaction extends WithProvenance {
  id: string;
  type: TxnType;
  amount: number;
  currency: string;
  date: string;            // YYYY-MM-DD
  time?: string;           // HH:MM local time
  description: string;
  category: string;
  note?: string;
  memberId?: string;
  recurring?: Recurrence;
  paymentMethod?: string;
  excluded?: boolean;
  linkedAssetId?: string;
  linkedToAssetId?: string;
  linkedDebtId?: string;
  linkedTxnId?: string;
  /** v7.1 Money Map — FK to `accounts.id`. Dual-written alongside
   *  `linkedAssetId` while flag is `'shadow'`; sole source once `'on'`. */
  accountId?: string;
  toAccountId?: string;
  /** v10.26.0 (R4) — an investment moves money between an ACCOUNT and an
   *  investment ASSET. Buy: `accountId` + `assetId`. Withdrawal: `toAccountId`
   *  + `assetId`. Legacy rows with both account FKs and no asset still fold. */
  assetId?: string;
  /** v10.25.0 (R3) — how the paying account was used; one of that account's
   *  `paymentModes`. Descriptive only: no balance or total reads it. `null` clears. */
  paymentMode?: PaymentMode | null;
  initiatedBy?: string;
  /** v7.3 — Money Map Item #5 (multi-account split). When set, the txn's
   *  total amount is divided across these accounts (e.g. partial debit +
   *  partial credit-card). Sum of `amount` must equal `Transaction.amount`.
   *  When unset, the single `accountId` is the source of funds. Persisted
   *  on the transaction directly; v7.4 may move this to its own table. */
  accountSplits?: AccountSplit[];
  split?: SplitInfo;
  /** v9 §2.3/§6.3 — system-written EMI split for category=loan_emi rows.
   *  Read-only to the user. Since v10.97.0 (Track E) BOTH legs count as Loan / EMI spending: the
   *  interest row is an expense, and the principal transfer reads as spending in `reportableTxns`.
   *  v9.4.2 — partPaymentChoice threads the user's re-amortisation strategy
   *  from the form into the store's loan_emi save path. */
  /** A loan payment's leg: the split the server computed (W4f: with the payment's kind, the instalment
   *  it paid and its operation id; a local-only payment also keeps what it changed, for undo). */
  emiSplit?: {
    interest: number; principal: number; debt_id: string; partPaymentChoice?: PartPaymentChoice;
    kind?: 'emi' | 'prepayment' | 'payoff' | 'bank_override'; instalment_no?: number | null; operation_id?: string;
    before?: { emi: number; due: string | null; closes: boolean; paidOff: boolean; balance: number };
  };
  /** v9.1 §5 — set on transactions MATERIALISED from a recurring schedule;
   *  links the instance back to its template (drives the §8 'from recurring' drill). */
  recurringScheduleId?: string;
  /** v9.1 §8 — direct link to a debt for the debt drill-down (payments/EMIs,
   *  receivable repayments). Nullable; backfilled from emiSplit.debt_id where present. */
  debtId?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AccountSplit {
  accountId: string;
  amount: number;
}

export type BudgetPeriod = 'monthly' | 'quarterly' | 'half_yearly' | 'annual' | 'custom';

// v9.1 §4 — a budget now has a STRICT identity (scope + year + month). This is
// what makes it the SAME budget on every device (fixes the item-2 cross-device
// divergence). A budget is a PERIOD CONTAINER whose total (`limit`) is split into
// per-category `BudgetAllocation` child rows (a cloud-synced table, not jsonb).
// Household budgeting is monthly or annual only. (Custom date-range budgets were
// removed — they added confusion without a clear use-case.)
export type BudgetScope = 'month' | 'annual';

export interface Budget extends WithProvenance {
  id: string;
  /** Legacy per-category budgets carried a category; v9.1 container budgets do
   *  not (categories live in BudgetAllocation). Optional for back-compat. */
  category?: string;
  /** The budget's TOTAL for the whole period window. Allocations sum to ≤ this. */
  limit: number;
  currency: string;
  color?: string;
  /** Strict identity: month (year+month) or annual (year). */
  scope?: BudgetScope;
  /** Set for month & annual; resolved year. */
  periodYear?: number;
  /** 1..12 — set for month only. */
  periodMonth?: number;
  /** v6.4 legacy budgeting period (retained so older helpers compile). */
  period?: BudgetPeriod;
  /** RESOLVED range (TD-13 columns) — first..last day of the month/year. */
  periodStart?: string;
  periodEnd?: string;
  /** v6.4.19 — TD-03 optimistic-concurrency precondition. */
  updated_at?: string;
}

/** v9.1 §4 — a per-category sub-limit within a Budget. Cloud-synced child row. */
export interface BudgetAllocation {
  id: string;
  budgetId: string;
  category: string;
  amount: number;
  /** TD-03 optimistic-concurrency precondition. */
  updated_at?: string;
}

export interface Goal extends WithProvenance {
  id: string;
  type: GoalType;
  name: string;
  target: number;
  current: number;
  currency: string;
  deadline?: string;
  completed: boolean;
  /** v6.4.19 — TD-03 optimistic-concurrency precondition. See Budget.updated_at. */
  updated_at?: string;
}

export interface Member {
  id: string;
  name: string;
  role: MemberRole;
  appRole?: AppRole;
  userId?: string;
}

export interface Debt extends WithProvenance {
  id: string;
  type: string;
  name: string;
  lender?: string;
  account?: string;
  principal: number;
  currentBalance: number;
  interestRate: number;
  minimumPayment: number;
  tenureMonths?: number;
  remainingMonths?: number; // v7 — re-amortised after part-payments
  dueDate?: string;
  currency: string;
  paymentLog?: PaymentLogEntry[];
  /** v7.1 Money Map — bidirectional debt support. `'owed_by_me'` is a
   *  liability (the legacy meaning); `'owed_to_me'` is a receivable shown
   *  separately on Net Worth. Defaults to `'owed_by_me'` for legacy rows. */
  direction?: 'owed_by_me' | 'owed_to_me';
  counterpartyName?: string;
  // ── W4e/W4f (v10.74.0/v10.75.0; owner decision D19) — the loan's terms. The OUTSTANDING is never
  // here: it is the loan account's ledger (lib/loanSchedule.ts loanOutstanding); currentBalance is a
  // cache the server keeps equal to it. minimumPayment is the EMI; dueDate is the NEXT instalment's date.
  /** The first EMI's date; with termsConfirmed false it is an estimate (existing loans). */
  firstEmiDate?: string;
  termsConfirmed?: boolean;
  /** Effective-dated rate changes ({from, rate}); empty = interestRate throughout. */
  rateHistory?: { from: string; rate: number }[];
  /** Instalments fully paid (the due one is the next). */
  instalmentsPaid?: number;
  /** The server records the EMI on its date from this account (a later release). */
  autoRecord?: boolean;
  fundingAccountId?: string;
  /** Set when nothing is owed any more (paid, or marked paid off). */
  paidOffAt?: string;
  /** v6.4.19 — TD-03 optimistic-concurrency precondition. See Budget.updated_at. */
  updated_at?: string;
}

export interface Asset extends WithProvenance {
  id: string;
  type: string;
  name: string;
  value: number;
  currency: string;
  liquidity: Liquidity;
  note?: string;
  lastUpdated?: string;
  /** v10.26.0 (R4) — investment assets fold like accounts. `value` is the
   *  OPENING value; live value = value + buys − withdrawals + valuationOffset
   *  (lib/accountBalance.ts computeAssetValue). "Update value" moves the offset
   *  with a dated log entry — never `value`, never a transaction. */
  valuationOffset?: number;
  valuationLog?: ReconciliationEntry[];
  /** v6.4.19 — TD-03 optimistic-concurrency precondition. See Budget.updated_at. */
  updated_at?: string;
}

// ─── v7.1 Money Map — first-class accounts + saved views ──────────────────

// v9 — strict kind enum (txn-redesign §2.2). 'checking'/'savings'/'wallet'/
// 'other' were remapped to 'bank' by the 20260608120000 migration.
// credit_card and loan are liabilities (negative to net worth).
export type AccountKind = 'cash' | 'bank' | 'credit_card' | 'investment' | 'loan';

/** v10.24.0 (R2) — how money moves through an account. Bank accounts use the
 *  first five, cards the next four, Cash in Hand only `cash`. The set is
 *  enforced by `ck_account_payment_modes`. */
export type PaymentMode =
  | 'upi' | 'debit_card' | 'net_banking' | 'cheque' | 'auto_debit'
  | 'swipe' | 'upi_on_card' | 'online' | 'standing_instruction'
  | 'cash';

export interface Account extends WithProvenance {
  id: string;
  /** Legacy back-link to the asset this account was synthesised from. Set
   *  by the Phase 1 backfill; null for accounts the user creates directly. */
  assetId?: string;
  /** Audit F2/§8.2 — explicit debt link for liability accounts (loan,
   *  credit_card). Replaces the old `assetId: debt.id` overload, which
   *  violated the FK (asset_id → assets, not debts). */
  debtId?: string;
  kind: AccountKind;
  name: string;
  currency: string;
  isDefault?: boolean;
  isArchived?: boolean;
  /** Money-Model B1.2 — opening balance captured at creation / onboarding.
   *  Current balance = openingBalance + credits − debits + reconciliationOffset.
   *  Provenance-tagged `estimated` until reconciled. Defaults to 0. */
  openingBalance?: number;
  /** v9 D2 — the "forgiveness" term: drift between computed and user-stated
   *  balance, absorbed here (NOT as a transaction). Feeds net worth/balances;
   *  NEVER read by spend/income aggregators. Investment value updates use the
   *  same field. Defaults to 0. */
  reconciliationOffset?: number;
  /** v9 D2 — dated audit trail of reconciliations; shown in account history only. */
  reconciliationLog?: ReconciliationEntry[];
  /** v10.24.0 (R2) — the payment modes used on this account. */
  paymentModes?: PaymentMode[];
  /** v10.24.0 (R2) — credit cards only. Outstanding, available and utilisation
   *  are DERIVED from this and the ledger balance (lib/accountsView.ts); none of
   *  them is stored, so none can drift. `null` clears the value. */
  creditLimit?: number | null;
  billingCycleDay?: number | null;
  paymentDueDay?: number | null;
  /** v10.24.0 (R2) — the last check against a statement, drift or not. Clears
   *  "not reconciled in N days" even when nothing needed correcting. */
  lastReconciledAt?: string | null;
  /** Row creation time (cloud). A never-reconciled account is judged stale from here. */
  createdAt?: string;
  updated_at?: string;
}

/** v9 D2 — one quiet-log entry: "reconciled ±X on <date>". */
export interface ReconciliationEntry {
  at: string;                    // ISO timestamptz
  delta: number;
  /** 'merge' (v10.24.0) records a balance folded in when another account's
   *  history was moved here before that account was deleted. */
  kind: 'bank' | 'investment' | 'credit_card' | 'merge' | 'loan';
  stated_value: number | null;
  note?: string;
}

/** v10.24.0 (R2) — what refers to an account. Built by the
 *  `account_dependencies` RPC in cloud mode, or from the store locally. */
export interface AccountDependencies {
  accountId: string;
  transactions: {
    count: number;
    total: number;
    firstDate: string | null;
    lastDate: string | null;
    /** The busiest descriptions (or categories), most transactions first. At most 3. */
    groups: { label: string; count: number; total: number }[];
  };
  recurring: { id: string; label: string }[];
  /** Shared splits on this account's transactions that are not yet closed. */
  openSplits: { id: string; txnId: string }[];
  loanEvents: number;
  /** v10.119.0 — live loans that record their EMIs automatically from this account. While there are any,
   *  it can't be deleted or archived; a move carries them (owner, 19 Oct 2026). */
  loans: { id: string; name: string }[];
}

/** v10.24.0 (R2) — result of moving an account's history, then deleting it. */
export interface AccountMoveResult {
  status: 'moved';
  transactions: number;
  schedules: number;
  /** The source's opening balance + offset, carried into the destination. */
  folded: number;
}

export type SavedViewPage = 'transactions' | 'reports' | 'insights';

export interface SavedView {
  id: string;
  userId: string;
  page: SavedViewPage;
  name: string;
  /** Sanitised filter parameters only. NEVER store transaction ids, member
   *  ids, or descriptions here — Sec-2 in SOLUTION_MONEY_MAP.md. */
  filters: Record<string, unknown>;
  isShared?: boolean;
  updated_at?: string;
}

export type TemplateKey =
  | 'young_couple' | 'family' | 'single' | 'self_employed' | 'retiree' | 'student';

export interface Profile {
  name: string;
  email: string;
  baseCurrency: string;
  language: string;
  household: ProfileTypeKey;
  dateFormat: 'us' | 'eu' | 'iso';
  /** v7.4.0 — large-number compaction system. 'western' uses K/M/B/T,
   *  'indian' uses K/L/Cr (lakh = 100K, crore = 10M). Defaults to 'western'. */
  numberSystem?: 'western' | 'indian';
  payoffStrategy: PayoffStrategy;
  extraPayment: number;
  // v7
  template?: TemplateKey;
  primaryConcern?: 'spending' | 'debt' | 'savings' | 'retirement';
  onboardedAt?: string;
  /** v7.3 — Money Map Migration B. Cloud-persisted education/onboarding
   *  progress: completed-at / dismissed-at per topic id. App caps at 50
   *  keys (Risk S-3) before pruning oldest by completed_at. */
  educationProgress?: EducationProgress;
}

/** Per-topic education state. Topic ids are app-defined strings such as
 *  `tour_v1`, `pulse_score`, `debt_strategy`. */
export interface EducationTopicState {
  completed_at?: string;
  dismissed_at?: string;
}
export type EducationProgress = Record<string, EducationTopicState>;

// v7 — Recurring schedules. v9.1 §5 adds RFC-5545 RRULE + owner; recurrence is
// authored ONLY here (the Transaction form no longer captures recurrence).
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom_day';

export interface RecurringSchedule {
  id: string;
  transactionTemplate: Omit<Transaction, 'id' | 'date'>;
  frequency: RecurrenceFreq;
  dayOfMonth?: number;       // for monthly + custom_day
  weekday?: number;          // 0-6 for weekly
  startDate: string;         // YYYY-MM-DD (DTSTART)
  nextDueDate: string;
  lastGenerated?: string;
  autoConfirm: boolean;
  /** Legacy lifecycle flag. v9.1 removes the on/off toggle from the UI; lifecycle
   *  is COUNT/UNTIL exhaustion or deletion. Kept (defaults true) for back-compat. */
  active: boolean;
  reminderLeadDays?: number; // 0-7 — fires upcoming-bill notif this many days before
  /** v9.1 §5.2 — RFC 5545 RRULE string, the source of truth for every date (W3e: the engine,
   *  the server, the bill calendar and the projections all read it through `ruleOf`; without one
   *  a rule is derived from frequency/dayOfMonth/weekday/startDate, as the database does). */
  rrule?: string;
  /** W3e (owner decision D13) — a 29th–31st (or Feb 29) in a shorter month: its last day (default)
   *  or the 1st of the next month. */
  shortMonthPolicy?: 'last_day' | 'next_month_first';
  /** v9.1 §5.3 — the household member the generated transactions are attributed
   *  to (flows to Transaction.memberId/initiatedBy). */
  ownerMemberId?: string;
  /** v8.9 — user who created the schedule. */
  createdBy?: string;
  /** TD-03 optimistic-concurrency precondition (cloud round-trip). */
  updated_at?: string;
}

// ── Notifications (Aurora v10.1 — 13-type model, notifications-spec.md) ──
// The 13 canonical types. P1 = action-required (pinned, decision buttons);
// P2 = informational (read / tap-to-navigate).
export type NotifType =
  | 'recurring_due_confirm' | 'recurring_reminder' | 'recurring_posted'
  | 'budget_threshold' | 'income_landed' | 'insight_fresh' | 'trend_alert'
  | 'debt_payment_due' | 'stale_balance' | 'invite_received'
  | 'member_activity' | 'sync_conflict' | 'milestone'
  // v10.14 — email-based cross-household split sharing. Generated locally on
  // each side (no cross-household writes needed — RLS already lets each
  // party read the shared_split rows relevant to them). split_received is
  // participant-facing (a split was shared with your email); split_settled is
  // owner-facing (a participant self-settled); split_closed is participant-
  // facing (the owner closed the split).
  | 'split_received' | 'split_settled' | 'split_closed'
  // v10.95.0 (#9) — an invitation of the open household is waiting (owner/admin-facing, with Revoke).
  // It and invite_received are built on the device from live data and never saved (lib/notifications.ts).
  | 'invite_pending';

export type NotifPriority = 'P1' | 'P2';

/** Serializable action descriptor. The NotificationSheet maps (notification,
 *  action.id) → a store handler at click time (a `run` function can't persist). */
export interface NotifActionSpec {
  id: string;
  label: string;
  kind: 'primary' | 'neu' | 'ghost';
}

export interface Notification {
  id: string;
  type: NotifType;
  priority: NotifPriority;
  title: string;
  body: string;
  createdAt: string;
  dueAt?: string;
  status: 'unread' | 'read' | 'dismissed';
  /** Active household this belongs to — the bell + list are scoped to it. */
  householdId?: string;
  memberId?: string;
  /** Money value the row highlights (rendered mono, tone from `type`). */
  amountRef?: number;
  /** Route (with `?param=` context) opened on row tap / a nav action. */
  deepLink?: string;
  actions?: NotifActionSpec[];
  /** Per-instance tint override (e.g. budget @100% → crit); else NOTIF_META. */
  tint?: string;
  /** Context FKs — consumed by action handlers + dedupe. */
  scheduleId?: string;
  budgetId?: string;
  debtId?: string;
  accountId?: string;
  txnId?: string;
  inviteToken?: string;
  /** v10.14 — the `shared_splits.id` a split_settled/split_closed row refers to. */
  splitId?: string;
  /** v10.95.0 — the `invitations.id` an invite_received / invite_pending card acts on. */
  invitationId?: string;
  /** Stable key so a given occurrence is only generated once. */
  dedupeKey?: string;
}

export interface NotificationPrefs {
  master: boolean;
  /** Per-type enable map; a type absent from the map is ENABLED by default.
   *  `sync_conflict` cannot be disabled (enforced in UI). */
  perType: Partial<Record<NotifType, boolean>>;
  quietStart: string;  // HH:MM
  quietEnd: string;    // HH:MM
  webPushEnabled: boolean;
  defaultLeadDays: 1 | 3 | 7;
  /** v10.126.0 (T4c; audit BE-FN-12; owner: "show by default, and hide via settings") — this device's
   *  notifications show their amounts and names. Off: a private line per type (`lockScreenText`).
   *  Absent (prefs saved before v10.126.0) means on. */
  lockScreenDetails?: boolean;
}

/** How a part-payment was applied. 'apply_advance' survives only on legacy payment-log entries (W4f retired it). */
export type PartPaymentChoice = 'reduce_tenure' | 'reduce_emi' | 'apply_advance';

// ── W4f (v10.75.0; owner decision D19) — paying a loan ─────────────────────────────
// The SERVER computes the split (pay_loan); the app says what kind of payment it is and how much.

/** One loan payment, as `pay_loan` takes it. */
export interface PayLoanInput {
  /** Idempotency key: a retry with the same id returns the first result. */
  operationId?: string;
  debtId: string;
  kind: 'emi' | 'prepayment' | 'payoff' | 'bank_override';
  amount: number;
  date?: string;
  /** A real account id or an encoded picker value; defaults to Cash in Hand. */
  fundingAccountId?: string;
  memberId?: string;
  description?: string;
  /** Prepayment only: keep the EMI and finish sooner, or keep the end date and pay less. */
  choice?: 'reduce_tenure' | 'reduce_emi';
  /** bank_override only: the bank's own split. */
  bankInterest?: number;
  bankPrincipal?: number;
}

export interface PayLoanResult {
  status: 'success' | 'duplicate';
  operationId: string;
  interest: number;
  principal: number;
  instalmentNo: number | null;
  closesInstalment: boolean;
  paidOff: boolean;
  outstandingAfter: number;
  nextDueDate: string | null;
  emiAfter: number;
  debt: Debt;
  loanAccount: Account | null;
  transactions: Transaction[];
}

/** What `pay_loan` will accept today (`loan_due`): the Pay form prefills from this. */
export interface LoanDue {
  outstanding: number;
  emi: number;
  paidOff: boolean;
  instalmentNo: number;
  dueDate: string | null;
  interest: number;
  due: number;
  paid: number;
  remaining: number;
  started: boolean;
  payoff: number;
  loanAccountId: string | null;
  latestPayment: { operationId: string; kind: string | null; amount: number; date: string | null } | null;
}

/** The command a cloud adapter sends (the store resolved the funding account and the id). */
export interface PayLoanCommand extends PayLoanInput {
  operationId: string;
  date: string;
  fundingAccountId: string;
}

export interface PaymentLogEntry {
  id: string;
  date: string;
  amount: number;
  interest: number;
  principal: number;
  outstandingAfter: number;
  isPartPayment: boolean;
  partChoice?: PartPaymentChoice;
}

export interface HouseholdMeta {
  id: string;
  name: string;
  type: ProfileTypeKey;
  baseCurrency: string;
  createdAt: string;
  /** v8 — per-household onboarding state machine record, cloud-persisted on the
   *  `households.onboarding` jsonb column. Shape defined in lib/onboardingState.
   *  Untyped here (Record) to avoid a types→lib import cycle; the lib casts it. */
  onboarding?: Record<string, unknown>;
}

export interface ExchangeRates {
  [currencyCode: string]: number;
}

export interface BackupV6 {
  /** Semver string of the consumer app that produced this backup, e.g. "6.3.1". */
  version: string;
  exported: string;
  profile: Profile;
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  members: Member[];
  debts: Debt[];
  assets: Asset[];
  exchangeRates: ExchangeRates;
}
