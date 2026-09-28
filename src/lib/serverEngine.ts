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
import { mapCloudRow, profileFromRows, type ProfileRowCols, type HouseholdRowCols } from './supabaseAdapter';
import { buildSafeSummary } from './aiSummary';
import { runAssistant, LlmBackend, type AssistantContext, type AssistantTurn } from './askVyactBackend';
import type { ModelCall } from './askVyactLlm';
import { normaliseChips, renderChipsAsNumberedList } from './askVyactResponses';
import { computeAccountBalance, reconcileAccount as buildReconcileOffset } from './accountBalance';
import { resolve } from './askVyactBackend';
import { spendByCategory } from './calculations';
import { getCat } from '../constants';
import {
  DEFAULT_PREFS, recurringDueNotifs, recurringReminderNotifs, budgetThresholdNotifs, debtDueNotifs,
  incomeLandedNotifs, staleBalanceNotifs,
} from './notifications';
import { toInsertRow, type NotifInsertRow } from './notificationRows';
import type { Notification } from '../types';

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
}

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

  const summary = buildSafeSummary(transactions, budgets, goals, debts, assets, profile, rates, accounts, budgetAllocations);
  summary.household.members = rows.memberCount;
  return {
    summary, transactions, budgets, budgetAllocations, goals, debts, assets, recurring,
    profile, rates, baseCurrency: profile.baseCurrency,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    channel: 'whatsapp',
  };
}

// ── "Reply UPDATE" (W6, v10.47.0) — the app's reconcile, run on the server ─────

/** The accounts "Reply UPDATE" walks through: the ones on the Accounts screen. */
const UPDATABLE_KINDS: readonly Account['kind'][] = ['bank', 'credit_card', 'cash'];
/** Not reconciled in this many days = stale (the nudge and the list agree). */
export const STALE_AFTER_DAYS = 30;

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
  const cutoff = nowMs - STALE_AFTER_DAYS * 86_400_000;
  return accounts
    .filter((a) => !a.isArchived && UPDATABLE_KINDS.includes(a.kind))
    .map((a) => ({ a, lastChecked: a.lastReconciledAt ?? a.createdAt ?? '' }))
    .filter(({ lastChecked }) => !lastChecked || Date.parse(lastChecked) < cutoff)
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
  const { accounts, transactions, debts, assets, profile, rates } = shapesFromRows(rows);
  const account = accounts.find((a) => a.id === accountId);
  if (!account || account.isArchived || !UPDATABLE_KINDS.includes(account.kind)) return null;
  const computed = computeAccountBalance(account, transactions, profile.baseCurrency, rates);
  const realBalance = stated === 'same' ? computed : stated;
  const kind = account.kind === 'credit_card' ? 'credit_card' as const : 'bank' as const;
  const { patch, delta } = buildReconcileOffset(account, computed, realBalance, kind);

  let bridge: ReconcilePlan['bridge'] = null;
  if (delta !== 0 && account.assetId) {
    if (account.kind === 'credit_card') {
      const debt = debts.find((x) => x.id === account.assetId);
      if (debt) bridge = { debt_id: debt.id, current_balance: Math.max(0, Math.abs(realBalance)) };
    } else {
      const asset = assets.find((x) => x.id === account.assetId);
      if (asset) bridge = { asset_id: asset.id, value: realBalance };
    }
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
  const ctx = { householdId, baseCurrency: profile.baseCurrency, rates };
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
