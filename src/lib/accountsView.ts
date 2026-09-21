// Vyact v10.24.0 (Accounts R2) — pure derivations for the Accounts screen.
//
// NOTHING HERE IS STORED. Balances come from the ledger (computeAccountBalance);
// everything a card shows — what is owed, what is still free, how much of the
// limit is used, which statement a spend falls in, when payment is due — is
// derived from the card's credit limit and that balance. So no figure on the
// screen can drift away from the transactions underneath it, and there is no
// second number to keep in sync.
//
// The one place a customer TYPES an "available limit" is when a card is first
// added: it seeds the opening balance (openingBalanceForCard). After that the
// available limit is derived, and a statement that disagrees is a reconcile —
// never an overwrite.
import type {
  Account, AccountDependencies, PaymentMode, RecurringSchedule, Transaction,
} from '../types';

/** A balance not checked against a statement for longer than this says so. */
export const STALE_AFTER_DAYS = 30;

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── grouping ─────────────────────────────────────────────────────────────────

export type AccountGroup = 'bank' | 'credit_card';

/**
 * Compatibility group for aggregate totals and account-history moves, or null
 * for loans (Debts) and investments (Net Worth). Cash is bank-compatible here;
 * the Accounts page presents Cash in Hand separately from the Bank group.
 */
export function accountGroup(a: Pick<Account, 'kind'>): AccountGroup | null {
  if (a.kind === 'bank' || a.kind === 'cash') return 'bank';
  if (a.kind === 'credit_card') return 'credit_card';
  return null;
}

// ── payment modes ────────────────────────────────────────────────────────────

/** The modes offered per account type, in display order. */
export const PAYMENT_MODES_BY_KIND: Record<'bank' | 'credit_card' | 'cash', readonly PaymentMode[]> = {
  bank: ['upi', 'debit_card', 'net_banking', 'cheque', 'auto_debit'],
  credit_card: ['swipe', 'upi_on_card', 'online', 'standing_instruction'],
  cash: ['cash'],
};

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  upi: 'UPI',
  debit_card: 'Debit card',
  net_banking: 'Net banking',
  cheque: 'Cheque',
  auto_debit: 'Auto-debit',
  swipe: 'Swipe / tap',
  upi_on_card: 'UPI on card',
  online: 'Online',
  standing_instruction: 'Standing instruction',
  cash: 'Cash',
};

// ── credit cards ─────────────────────────────────────────────────────────────

export interface CardFigures {
  limit: number;
  /** What is owed now — never negative. */
  outstanding: number;
  /** What is still free. An overpaid card has more than its limit free. */
  available: number;
  /** outstanding / limit, 0…1+ (can exceed 1 when over the limit). */
  utilisation: number;
}

/**
 * A card's figures from its limit and its LEDGER balance (negative = owed).
 * Null when the card has no limit recorded — there is nothing honest to show.
 */
export function cardFigures(creditLimit: number | null | undefined, balance: number): CardFigures | null {
  if (!creditLimit || creditLimit <= 0) return null;
  const outstanding = round2(Math.max(0, -balance));
  return {
    limit: creditLimit,
    outstanding,
    available: round2(creditLimit + balance),
    utilisation: outstanding / creditLimit,
  };
}

/**
 * The opening balance a NEW card starts from, given the two limits typed into
 * the form: outstanding = limit − available, and a card's balance is what it
 * owes, negated. The inverse of cardFigures' `available`.
 */
export function openingBalanceForCard(creditLimit: number, availableLimit: number): number {
  return round2(availableLimit - creditLimit);
}

// ── cycle dates ──────────────────────────────────────────────────────────────

const lastDayOf = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The statement window containing `now`: from the billing-cycle day to the day
 * before the next one. A cycle day past the end of a short month clamps to that
 * month's last day, as issuers do.
 */
export function statementWindow(cycleDay: number, now: Date): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let sy = y;
  let sm = m;
  if (now.getUTCDate() < Math.min(cycleDay, lastDayOf(y, m))) {
    sm = m - 1;
    if (sm < 0) { sm = 11; sy = y - 1; }
  }
  const start = Date.UTC(sy, sm, Math.min(cycleDay, lastDayOf(sy, sm)));
  const ny = sm === 11 ? sy + 1 : sy;
  const nm = (sm + 1) % 12;
  const nextStart = Date.UTC(ny, nm, Math.min(cycleDay, lastDayOf(ny, nm)));
  return { start: isoDate(start), end: isoDate(nextStart - DAY_MS) };
}

/** The next payment due date on or after today, clamped to short months. */
export function nextDueDate(dueDay: number, now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = Math.min(dueDay, lastDayOf(y, m));
  if (now.getUTCDate() <= thisMonth) return isoDate(Date.UTC(y, m, thisMonth));
  const ny = m === 11 ? y + 1 : y;
  const nm = (m + 1) % 12;
  return isoDate(Date.UTC(ny, nm, Math.min(dueDay, lastDayOf(ny, nm))));
}

// ── reconciliation freshness ─────────────────────────────────────────────────

/** When the account was last checked against a statement, or null if never. */
export function lastReconciledAt(
  a: Pick<Account, 'lastReconciledAt' | 'reconciliationLog'>,
): string | null {
  if (a.lastReconciledAt) return a.lastReconciledAt;
  const log = a.reconciliationLog ?? [];
  if (!log.length) return null;
  return log.reduce((latest, e) => (e.at > latest ? e.at : latest), log[0].at);
}

/**
 * Days since the balance was checked, when that is longer than
 * STALE_AFTER_DAYS; null when it is fresh. A never-reconciled account counts
 * from its creation, so a card added yesterday is not called stale.
 */
export function staleDays(
  a: Pick<Account, 'lastReconciledAt' | 'reconciliationLog' | 'createdAt'>,
  now: Date,
): number | null {
  const since = lastReconciledAt(a) ?? a.createdAt ?? null;
  if (!since) return null;
  const days = Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS);
  return days > STALE_AFTER_DAYS ? days : null;
}

// ── summary ──────────────────────────────────────────────────────────────────

export interface AccountsSummary {
  /** Everything the Bank group holds (Cash in Hand included). */
  cashAvailable: number;
  /** Everything the cards owe. */
  cardOutstanding: number;
  /** cashAvailable − cardOutstanding. */
  spendableNow: number;
}

/**
 * Spendable now = what the Bank group holds minus what the cards owe. Archived
 * accounts, and accounts that live in other modules, are left out. An overpaid
 * card owes nothing; its credit is not counted as cash.
 */
export function accountsSummary(accounts: Account[], balanceOf: (a: Account) => number): AccountsSummary {
  let cash = 0;
  let owed = 0;
  for (const a of accounts) {
    if (a.isArchived) continue;
    const group = accountGroup(a);
    if (group === 'bank') cash += balanceOf(a);
    else if (group === 'credit_card') owed += Math.max(0, -balanceOf(a));
  }
  cash = round2(cash);
  owed = round2(owed);
  return { cashAvailable: cash, cardOutstanding: owed, spendableNow: round2(cash - owed) };
}

// ── delete guard ─────────────────────────────────────────────────────────────

/**
 * True when anything refers to the account — a transaction, a schedule, an
 * unsettled split or loan history. Permanent delete is offered only when this
 * is false; otherwise the choice is archive (recommended) or move-then-delete.
 */
export function hasDependencies(d: AccountDependencies): boolean {
  return d.transactions.count > 0 || d.recurring.length > 0
    || d.openSplits.length > 0 || d.loanEvents > 0;
}

/**
 * Local-only mode's equivalent of the `account_dependencies` RPC, built from
 * the store — same shape and the same grouping rule, so the delete guard reads
 * identically offline. Shared splits and loan payment events are cloud-only.
 */
export function localAccountDependencies(
  accountId: string,
  transactions: Transaction[],
  schedules: RecurringSchedule[],
): AccountDependencies {
  const txns = transactions.filter(t => t.accountId === accountId || t.toAccountId === accountId);
  const groups = new Map<string, { label: string; count: number; total: number }>();
  for (const t of txns) {
    const label = (t.description ?? '').trim() || t.category || t.type;
    const g = groups.get(label) ?? { label, count: 0, total: 0 };
    g.count += 1;
    g.total = round2(g.total + t.amount);
    groups.set(label, g);
  }
  const dates = txns.map(t => t.date).sort();
  return {
    accountId,
    transactions: {
      count: txns.length,
      total: round2(txns.reduce((sum, t) => sum + t.amount, 0)),
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      groups: [...groups.values()].sort((a, b) => b.count - a.count || b.total - a.total).slice(0, 3),
    },
    recurring: schedules
      .filter(s => s.transactionTemplate.accountId === accountId || s.transactionTemplate.toAccountId === accountId)
      .map(s => ({ id: s.id, label: s.transactionTemplate.description || s.transactionTemplate.category || 'Recurring' })),
    openSplits: [],
    loanEvents: 0,
  };
}

/**
 * Where an account's history may be moved: a live, unarchived account in the
 * SAME group. Bank and Cash in Hand can take each other's history; a card only
 * another card's. Crossing groups would move value between the asset and
 * liability sides of net worth.
 */
export function moveDestinations(source: Account, accounts: Account[]): Account[] {
  const group = accountGroup(source);
  if (!group) return [];
  return accounts.filter(a => a.id !== source.id && !a.isArchived && accountGroup(a) === group);
}

// ── input ────────────────────────────────────────────────────────────────────

/**
 * A money amount typed into a form, or null when the field is empty or not a
 * number. Grouping commas are allowed (Indian "1,50,000" as well as "150,000").
 */
export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.replace(/,/g, '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
