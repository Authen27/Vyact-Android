// Ask Vyact — the SAME engine, run on the server (W4, v10.45.0).
//
// WhatsApp has no browser, and money must be computed server-side. Rather than a
// second, hand-ported implementation of every money rule (which drifts — the v10.37
// bug class), the server runs THIS code: `scripts/build-agent-engine.mjs` bundles
// this module and everything it imports into
// `supabase/functions/_shared/agent/engine.generated.js`, and the gate fails if that
// file is stale. One implementation; parity by construction.
//
// This module must stay PURE: no store, no browser APIs, no Supabase client. It is
// handed plain database rows and a model call, and returns a turn.
//
// What it does, in the order the app does it (pages/Chat.tsx):
//   1. rows → app shapes with the adapter's own mappers (`mapCloudRow`,
//      `profileFromRows`) — so a server figure is computed from exactly the objects
//      the app would hold;
//   2. `buildSafeSummary` over them — the one egress shape;
//   3. `runAssistant` with the injected model call — classify → resolve → phrase,
//      with `assertNoInventedFigures` guarding the reply;
//   4. render for WhatsApp: plain text, chips as a numbered list.

import type {
  Transaction, Budget, BudgetAllocation, Goal, Debt, Asset, Account, RecurringSchedule, ExchangeRates,
} from '../types';
import { DEFAULT_RATES } from '../constants';
import { mapCloudRow, profileFromRows, txnToRow, type ProfileRowCols, type HouseholdRowCols } from './supabaseAdapter';
import { generateTransaction, advanceSchedule, isStaleOccurrence, serverPostsSchedule } from './recurring';
import { buildSafeSummary } from './aiSummary';
import { classificationMap } from './spendBaseline';
import { runAssistant, LlmBackend, type AssistantContext, type AssistantTurn } from './askVyactBackend';
import type { ModelCall } from './askVyactLlm';
import { normaliseChips, renderChipsAsNumberedList } from './askVyactResponses';
import { computeAccountBalance, reconcileAccount as buildReconcileOffset } from './accountBalance';
import { lastReconciledAt, staleAccounts, STALE_AFTER_DAYS as STALE_DAYS } from './accountsView';
import { resolve } from './askVyactBackend';
import { spendByCategory } from './calculations';
import { getCat } from '../constants';
import {
  DEFAULT_PREFS, recurringDueNotifs, recurringReminderNotifs, budgetThresholdNotifs, budgetThresholdLines, debtDueNotifs,
  incomeLandedNotifs, staleBalanceNotifs, lockScreenText, type BudgetThresholdLine,
} from './notifications';
import { toInsertRow, type NotifInsertRow } from './notificationRows';
import { wallClock } from './format';
import type { Notification } from '../types';

// W1c (v10.64.0, audit BE-PIP-02): the `ask-vyact` gateway composes Pip's prompts from this
// closed set, so the browser sends an op and text, never a system prompt.
export { systemPromptFor, cleanOffending } from './askVyactLlm';

// Track E (v10.96.0; audit XC-ARC-06) — WhatsApp's alerts and digests read spending through the APP's
// rules over the APP's row mapping. They used to read a hand-copied port (`_shared/money`) with its own
// row mapping, which dropped `emi_split`; a change to what counts as spending now reaches them at once.
export { spendRows, spendByCategoryInRange, effectiveAmount, spendEntryKey, countSpendEntries } from './calculations';

/** `transactions` rows → the app's Transactions, with the adapter's own mapper. */
export function txnsFromRows(rows: readonly unknown[]): Transaction[] {
  return rows.map((r) => mapCloudRow('transactions', r) as Transaction);
}

/** Everything the engine needs about one household, as rows straight from Postgres. */
export interface HouseholdRows {
  transactions: unknown[];
  budgets: unknown[];
  budgetAllocations: unknown[];
  goals: unknown[];
  debts: unknown[];
  assets: unknown[];
  accounts: unknown[];
  recurring: unknown[];
  memberCount: number;
  rates: { currency_code: string; rate_to_usd: number | string }[];
  profile: ProfileRowCols;
  household: HouseholdRowCols;
  email: string;
  /**
   * Track E, E4 — the `category_classifications` rows (a small global table), so the server's
   * essential spend uses the same live need/want map as the app. Absent = the built-in map.
   */
  classifications?: { category: string; classification: string }[];
}

/**
 * W3a (v10.65.0) — the household's zone. The server's clock is UTC, so every calendar "today" and
 * "this month" the engine computes for a household is read in this zone (the DB default is India's).
 */
export const DEFAULT_HOUSEHOLD_TZ = 'Asia/Kolkata';
const householdTz = (rows: HouseholdRows): string => rows.household?.timezone || DEFAULT_HOUSEHOLD_TZ;

/** Rows → the app's own shapes, with the adapter's mappers and the store's rate rule. */
function shapesFromRows(rows: HouseholdRows) {
  const map = <T>(entity: Parameters<typeof mapCloudRow>[0], list: unknown[]): T[] =>
    list.map((r) => mapCloudRow(entity, r) as T);
  const profile = profileFromRows(rows.profile, rows.household, rows.email);
  // The store's rule: the household's saved rates when it has any, else the defaults.
  const saved: ExchangeRates = Object.fromEntries(rows.rates.map((r) => [r.currency_code, Number(r.rate_to_usd)]));
  const rates: ExchangeRates = Object.keys(saved).length ? saved : { ...DEFAULT_RATES };
  return {
    transactions: map<Transaction>('transactions', rows.transactions),
    budgets: map<Budget>('budgets', rows.budgets),
    budgetAllocations: map<BudgetAllocation>('budgetAllocations', rows.budgetAllocations),
    goals: map<Goal>('goals', rows.goals),
    debts: map<Debt>('debts', rows.debts),
    assets: map<Asset>('assets', rows.assets),
    accounts: map<Account>('accounts', rows.accounts),
    recurring: map<RecurringSchedule>('recurring', rows.recurring),
    profile, rates,
  };
}

/** The AssistantContext Chat.tsx would build for this household. */
export function contextFromRows(rows: HouseholdRows): AssistantContext {
  const { transactions, budgets, budgetAllocations, goals, debts, assets, accounts, recurring, profile, rates } = shapesFromRows(rows);

  const tz = householdTz(rows);
  const summary = buildSafeSummary(transactions, budgets, goals, debts, assets, profile, rates, accounts, budgetAllocations, tz,
    classificationMap(rows.classifications));
  summary.household.members = rows.memberCount;
  return {
    summary, transactions, budgets, budgetAllocations, goals, debts, assets, recurring,
    profile, rates, baseCurrency: profile.baseCurrency,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    channel: 'whatsapp',
    tz,
  };
}

// ── "Reply UPDATE" (W6, v10.47.0) — the app's reconcile, run on the server ─────

/** The accounts "Reply UPDATE" walks through: the ones on the Accounts screen. */
const UPDATABLE_KINDS: readonly Account['kind'][] = ['bank', 'credit_card', 'cash'];
/** Not reconciled in this many days = stale (the nudge and the list agree). */
export const STALE_AFTER_DAYS = STALE_DAYS;   // W8a (INT-PAR-05): one constant, lib/accountsView.ts

export interface BalanceToCheck {
  id: string;
  name: string;
  kind: Account['kind'];
  /** The live balance, exactly as the Accounts screen computes it. */
  balance: number;
  /** A card's outstanding (what is owed), max(0, −balance); undefined for others. */
  owed?: number;
  /** When it was last checked against a statement (or created, if never). */
  lastChecked: string;
}

/** Stale bank, card and cash accounts, oldest check first. */
export function balancesToCheck(rows: HouseholdRows, nowMs: number): BalanceToCheck[] {
  const { accounts, transactions, profile, rates } = shapesFromRows(rows);
  // W8a (audit INT-PAR-05): the one stale rule the bell, push and Accounts screen use.
  return staleAccounts(accounts, new Date(nowMs))
    .map((a) => ({ a, lastChecked: lastReconciledAt(a) ?? a.createdAt ?? '' }))
    .sort((x, y) => (Date.parse(x.lastChecked) || 0) - (Date.parse(y.lastChecked) || 0))
    .map(({ a, lastChecked }) => {
      const balance = computeAccountBalance(a, transactions, profile.baseCurrency, rates);
      return {
        id: a.id, name: a.name, kind: a.kind, balance, lastChecked,
        ...(a.kind === 'credit_card' ? { owed: Math.max(0, -balance) } : {}),
      };
    });
}

export interface ReconcilePlan {
  accountId: string;
  name: string;
  kind: Account['kind'];
  /** The balance before, and after the correction. */
  before: number;
  after: number;
  delta: number;
  /** The offset the plan was computed from (the RPC refuses if it has moved). */
  expectedOffset: number;
  offset: number;
  log: unknown[];
  at: string;
  /** reconcileSlice's net-worth bridge to the linked Asset or Debt. */
  bridge: { debt_id: string; current_balance: number } | { asset_id: string; value: number } | null;
}

/**
 * Exactly what the Reconcile sheet does (ReconcileSheet → reconcileSlice), without
 * the store: delta = stated − computed goes into the reconciliation offset with a
 * dated log entry — never a transaction. A card is stated as what is OWED
 * (accountBalance.reconcileAccount targets −outstanding, INV-10/11). 'same' is the
 * sheet's no-drift path: it reconciles to the computed balance itself, which books
 * nothing but still stamps the check.
 */
export function reconcileOnServer(rows: HouseholdRows, accountId: string, stated: number | 'same', at: string): ReconcilePlan | null {
  const { accounts, transactions, assets, profile, rates } = shapesFromRows(rows);
  const account = accounts.find((a) => a.id === accountId);
  if (!account || account.isArchived || !UPDATABLE_KINDS.includes(account.kind)) return null;
  const computed = computeAccountBalance(account, transactions, profile.baseCurrency, rates);
  const realBalance = stated === 'same' ? computed : stated;
  const kind = account.kind === 'credit_card' ? 'credit_card' as const : 'bank' as const;
  const { patch, delta } = buildReconcileOffset(account, computed, realBalance, kind);

  // W4f (D30) — a card is an account: it has no debt row to bridge to (the old `assetId = debt.id`
  // bridge is gone). A bank account that stands for an asset still carries the stated value to it.
  let bridge: ReconcilePlan['bridge'] = null;
  if (delta !== 0 && account.assetId && account.kind !== 'credit_card') {
    const asset = assets.find((x) => x.id === account.assetId);
    if (asset) bridge = { asset_id: asset.id, value: realBalance };
  }
  return {
    accountId, name: account.name, kind: account.kind,
    before: computed, after: Math.round((computed + delta) * 100) / 100, delta,
    expectedOffset: account.reconciliationOffset ?? 0,
    offset: patch.reconciliationOffset ?? 0,
    log: (patch.reconciliationLog ?? []) as unknown[],
    at, bridge,
  };
}

// ── "paid X" (W3e, v10.69.0) — the app's Approve, run on the server ─────────────────

export interface ApprovalPlan {
  /** The transaction row the app's Approve writes (generateTransaction → txnToRow), JSON-clean. */
  row: Record<string, unknown>;
  /** The schedule's next due date after this occurrence; null when it was the last one. */
  nextDue: string | null;
  /** COUNT / UNTIL is used up: the schedule closes instead of moving on. */
  exhausted: boolean;
}

/**
 * Exactly what approving the due occurrence does in the app (recurringSlice.approveRecurring):
 * the occurrence row under its deterministic id, and the schedule advanced by its RULE with its
 * month-end policy. This replaced the `_shared/recurring.ts` hand port, which stepped month-ends
 * differently from the app and knew nothing of weekdays, COUNT or UNTIL (audit XC-ARC-01, INT-PAR-02).
 * `whatsapp_approve_recurring` applies the plan in one transaction.
 */
export function approveOccurrenceOnServer(scheduleRow: unknown, householdId: string): ApprovalPlan {
  const schedule = mapCloudRow('recurring', scheduleRow) as RecurringSchedule;
  const row = JSON.parse(JSON.stringify(txnToRow(generateTransaction(schedule), householdId))) as Record<string, unknown>;
  const advanced = advanceSchedule(schedule);
  const exhausted = advanced.active === false;
  return { row, nextDue: exhausted ? null : advanced.nextDueDate, exhausted };
}

// ── Posting due bills (W4a, v10.70.0; owner decision D16) ──────────────────────────

export interface PostingPlan {
  /** The pointer this plan acts on; `post_recurring_occurrence` refuses it if it has moved. */
  occurrence: string;
  /** False: the pointer is older than the catch-up horizon and is moved on WITHOUT posting. */
  post: boolean;
  /** The occurrence row (when posting), exactly as the app's engine writes it. */
  row: Record<string, unknown> | null;
  nextDue: string | null;
  lastGenerated: string;
  /** COUNT / UNTIL used up: the schedule closes. */
  exhausted: boolean;
}

/**
 * What the app's engine (recurringSlice.runRecurringEngine) would do with this schedule today, for
 * the server job that now does it in cloud mode. Null when there is nothing to do: not active, not
 * one the server posts (`serverPostsSchedule`), or not due yet in the household's zone (`today`).
 * A pointer past the catch-up horizon is fast-forwarded without posting, as the app does.
 */
export function recurringPostPlan(scheduleRow: unknown, householdId: string, today: string): PostingPlan | null {
  const schedule = mapCloudRow('recurring', scheduleRow) as RecurringSchedule;
  if (!schedule.active || !serverPostsSchedule(schedule) || schedule.nextDueDate > today) return null;
  if (isStaleOccurrence(schedule.nextDueDate, today)) {
    let ff = schedule;
    for (let guard = 0; guard < 480 && ff.active && isStaleOccurrence(ff.nextDueDate, today); guard++) ff = advanceSchedule(ff);
    return {
      occurrence: schedule.nextDueDate, post: false, row: null,
      nextDue: ff.active ? ff.nextDueDate : null, lastGenerated: ff.lastGenerated ?? schedule.nextDueDate, exhausted: !ff.active,
    };
  }
  const plan = approveOccurrenceOnServer(scheduleRow, householdId);
  return { occurrence: schedule.nextDueDate, post: true, lastGenerated: schedule.nextDueDate, ...plan };
}

// ── Runway (W6, v10.47.0) — the runway alerts read the app's own forecast ─────────

export interface RunwaySnapshot {
  /** Months the liquid savings would last, one decimal; null with no spending basis. */
  months: number | null;
  /** The category that fell most from the month before last to last month, named. */
  quieterCategory: string | null;
}

/**
 * The runway exactly as Pip states it (`forecast.runway`: liquid savings over typical
 * monthly spending, both from the one SafeSummary projection), plus the category
 * whose spending fell most between the last two COMPLETED months, for "what moved it".
 * `now` is the caller's clock, so a scheduled run is reproducible.
 */
export function runwaySnapshot(rows: HouseholdRows, now: Date): RunwaySnapshot {
  const ctx = contextFromRows(rows);
  const r = resolve({ id: 'forecast.runway', bucket: 'forecast', confidence: 1, entities: { text: 'how long would my savings last' } }, ctx);
  const raw = Number((r.facts as { months_money_would_last?: string } | undefined)?.months_money_would_last);
  const basisMonths = ctx.summary.spendBasis?.monthsConsidered ?? 0;
  const months = Number.isFinite(raw) && basisMonths > 0 ? Math.round(raw * 10) / 10 : null;
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  now = wallClock(ctx.tz, now);   // W3a: last month is the HOUSEHOLD's last month, not the UTC host's
  const last = key(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const before = key(new Date(now.getFullYear(), now.getMonth() - 2, 1));
  const a = spendByCategory(ctx.transactions, before, ctx.baseCurrency, ctx.rates);
  const b = spendByCategory(ctx.transactions, last, ctx.baseCurrency, ctx.rates);
  let best: { cat: string; drop: number } | null = null;
  for (const [cat, was] of Object.entries(a)) {
    const drop = was - (b[cat] ?? 0);
    if (drop > 0 && (!best || drop > best.drop)) best = { cat, drop };
  }
  return { months, quieterCategory: best ? getCat(best.cat).label : null };
}

// ── Notifications, generated on the server (v10.48.0, TD-22) ─────────────────

/**
 * The bell notifications the APP would raise for this household right now, as
 * `notifications` rows: the same generators (lib/notifications.ts) over the same
 * mapped shapes, so a phone is told about a due bill or a budget line at 80% even
 * when no device has the app open. `existingKeys` are the household's stored
 * dedupe keys: anything already raised (by a device or an earlier run) is skipped,
 * and the insert is ignore-duplicates on (household_id, dedupe_key) besides.
 *
 * Generated with the default preferences (every type on): which of them reach a
 * lock screen is each device's own choice, applied when pushing.
 * Split notifications are not generated here: they come from the devices, which
 * hold the verified-email split lists.
 */
export function notificationsOnServer(rows: HouseholdRows, existingKeys: readonly string[], householdId: string): NotifInsertRow[] {
  const { transactions, budgets, budgetAllocations, debts, accounts, recurring, profile, rates } = shapesFromRows(rows);
  const existing = existingKeys.map((dedupeKey) => ({ dedupeKey }) as Notification);
  const ctx = { householdId, baseCurrency: profile.baseCurrency, rates, tz: householdTz(rows) };
  const prefs = DEFAULT_PREFS;
  return [
    ...recurringDueNotifs(recurring, prefs, existing, ctx),
    ...recurringReminderNotifs(recurring, prefs, existing, ctx),
    ...budgetThresholdNotifs(budgets, budgetAllocations, transactions, prefs, existing, ctx),
    ...debtDueNotifs(debts, prefs, existing, ctx),
    ...incomeLandedNotifs(transactions, prefs, existing, ctx),
    ...staleBalanceNotifs(accounts, prefs, existing, ctx),
  ].map(toInsertRow);
}

/**
 * v10.126.0 (T4c; audit BE-FN-12) — what a push says on a device whose "Show details on the lock screen" is
 * off: the app's own private line for the type (`lockScreenText`), so the server and the open app never differ.
 */
export function lockScreenTextOnServer(type: string): { title: string; body: string } {
  return lockScreenText(type);
}

// ── T5c (v10.122.0) — WhatsApp's scheduled nudges read the app's own rules ──────────────────────────

export type { BudgetThresholdLine };

/**
 * Audit XC-ARC-06 — the budget lines at or past a threshold today, by the app's rule
 * (`budgetThresholdLines`, the one the bell and push raise from), over `budgets`, `budget_allocations`
 * and `transactions` rows mapped by the app's adapter. WhatsApp's budget alert kept its own 80% rule
 * until v10.122.0. A household's amounts are read at face value (one currency, D14).
 */
export function budgetLinesOnServer(
  rows: { budgets: readonly unknown[]; budgetAllocations: readonly unknown[]; transactions: readonly unknown[] },
  baseCurrency: string, today: string,
): BudgetThresholdLine[] {
  return budgetThresholdLines(
    rows.budgets.map((r) => mapCloudRow('budgets', r) as Budget),
    rows.budgetAllocations.map((r) => mapCloudRow('budgetAllocations', r) as BudgetAllocation),
    txnsFromRows(rows.transactions),
    { baseCurrency, rates: { ...DEFAULT_RATES } }, today,
  );
}

/**
 * Audit INT-PAR-05 — how many of these `accounts` rows the app calls stale (`staleAccounts`: bank, card
 * and cash, not archived, last checked STALE_AFTER_DAYS ago or more, by the last reconcile, else the last
 * log entry, else creation). The WhatsApp nudge counted with its own rule until v10.122.0, and could
 * say "2 balances" while the bell said 1.
 */
export function staleAccountCount(accountRows: readonly unknown[], nowMs: number): number {
  return staleAccounts(accountRows.map((r) => mapCloudRow('accounts', r) as Account), new Date(nowMs)).length;
}

/** One question, answered by the app's own pipeline with the given model call. */
export function answerOnServer(
  utterance: string, ctx: AssistantContext, call: ModelCall, prevAllowed: readonly string[] = [],
): Promise<AssistantTurn> {
  return runAssistant(utterance, ctx, new LlmBackend(call), Date.now(), undefined, prevAllowed);
}

export interface WhatsAppAnswer {
  text: string;
  /** What each numbered reply sends as the next question. */
  chipPrompts: string[];
}

/** WhatsApp's hard limit on a text message. */
export const WHATSAPP_MAX_CHARS = 4096;

/**
 * A turn as a WhatsApp message: no markdown (WhatsApp would show the asterisks), and
 * chips as a numbered list the person answers with "1", "2" or "3".
 */
export function renderForWhatsApp(turn: AssistantTurn, appUrl: string): WhatsAppAnswer {
  // In the app these open a pre-filled form; WhatsApp has none. Say what works here.
  if (turn.recurringSeed) {
    return { text: `Recurring bills are set up in the app, so you can check the schedule before it starts: ${appUrl}/recurring`, chipPrompts: [] };
  }
  // v10.109.0 (R-1): an EMI is set up on its loan, in the app (Debts), with Record automatically on.
  if (turn.loanSeed) {
    return { text: turn.loanSeed.mode === 'new'
      ? `A loan's EMI is set up on the loan, in the app: Debts › Add loan, with Record automatically on. Vyact then records each EMI on its date: ${appUrl}/debts`
      : `Turn on Record automatically on the loan, in the app: Recurring › Loan EMIs. Vyact then records each EMI on its date: ${appUrl}/recurring`,
      chipPrompts: [] };
  }
  if (turn.seed) {
    return { text: 'To record it here, send it as one line, like 450 lunch hdfc.', chipPrompts: [] };
  }
  const plain = turn.reply
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
  // The one chip contract (askVyactResponses): max three, each asks something.
  const chips = normaliseChips(turn.chips) ?? [];
  const menu = chips.length ? `\n\n${renderChipsAsNumberedList(chips)}\n\nReply with a number, or ask anything.` : '';
  const room = WHATSAPP_MAX_CHARS - menu.length;
  const body = plain.length > room ? `${plain.slice(0, room - 1).trimEnd()}…` : plain;
  return { text: `${body}${menu}`, chipPrompts: chips.map((c) => c.prompt) };
}
