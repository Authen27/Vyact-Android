// Vyact — Ask Vyact assistant backend (engineering spec §3, §4, §5, §6).
//
// Orchestrates the five-stage deterministic pipeline:
//   [1] normalise → [2] entityExtract → [3] classifyIntent → [4] resolve → [5] phraseResponse
//
// The two SEAMS a future LlmBackend swaps in are stages 3 and 5, expressed as the
// `AssistantBackend` interface. Stages 1, 2, 4 are pure functions over Vyact data
// and are model-agnostic — they are NEVER delegated to a model. In particular
// stage 4 (`resolve`) is the only place money is computed, and it does so purely
// by calling the SAME services that power the dashboard. The assistant phrases;
// services compute.

import type {
  Transaction, Budget, Goal, Debt, Asset, Profile, ExchangeRates, SplitInfo, TxnType, RecurringSchedule,
  BudgetAllocation,
} from '../types';
import {
  spendByCategory, spendByCategoryInRange, reportableTxns, effectiveAmount, monthlyData, totalMonthlyDebtPayment,
  budgetLinesForMonth,
} from './calculations';
// v10.38 — period/date/account resolution lives in the parser, next to the entity
// shape it reads, and is unit-tested there.
import {
  resolvePeriod, resolveDayWindow, parseDateEntity, matchAccountId, matchCategory, resolveCategoryId,
  statedCurrency, amountLooksLikeIdentifier, normalise,
} from './askVyactParser';
import { getCat, NEEDS_WANTS_MAP, CURRENCIES, EXPENSE_CATEGORIES } from '../constants';
import { fmt, convert } from './format';
import { nowMonthKey, getMonthKey } from './format';
import type { SafeSummary } from './aiSummary';
import type { IntentResult, AssistantBucket } from './askVyactIntents';
import { normaliseChips, type AssistantChip, type ResolveResult, type RecurringSeed } from './askVyactResponses';
import {
  classifyIntentViaModel, phraseViaModel,
  InventedFigureError, ModelUnavailableError, type ModelCall,
} from './askVyactLlm';
import { resolveConfiguredModelCall } from './askVyactModelCall';
import { isAskVyactBucketEnabled, FEATURES } from '../config/features';

// ── Context passed through the pipeline (the same data the dashboard reads) ─────
export interface AssistantContext {
  summary: SafeSummary;
  transactions: Transaction[];
  budgets: Budget[];
  /**
   * v10.48.1 — the budgets' per-category allocations. Since v9.1 a budget is a period
   * container with NO category of its own; its categories live here. Without them a
   * "what's my Groceries budget" lookup finds nothing. Optional for older callers.
   */
  budgetAllocations?: BudgetAllocation[];
  goals: Goal[];
  debts: Debt[];
  assets: Asset[];
  profile: Profile;
  rates: ExchangeRates;
  baseCurrency: string;
  /** Recurring schedules — for "upcoming bills". Optional; defaults to none. */
  recurring?: RecurringSchedule[];
  /**
   * v10.38 — the household's accounts, for seeding the paying account when a bank
   * message names one. Ids and names only; no balances are read here (money still
   * comes from the summary's canonical projection). Optional: callers that never
   * capture can omit it.
   */
  accounts?: { id: string; name: string; kind?: string }[];
  /**
   * v10.46.0 — where the answer will be read. WhatsApp answers are shorter, carry no
   * links and are English only; the app mirrors Hinglish. Defaults to the app.
   */
  channel?: 'app' | 'whatsapp';
}

// ── The two-method seam (rules now, LLM later) ─────────────────────────────────
// Both methods are ASYNC. The rules implementation resolves immediately (no I/O),
// but the signature must be Promise-shaped so a network-backed LlmBackend can be
// dropped in without touching a single call site. Stages 1/2/4 stay synchronous
// and pure — only the seam awaits.
export interface AssistantBackend {
  id: 'rules' | 'llm';
  classifyIntent(utterance: string, ctx: AssistantContext): Promise<IntentResult>;   // stage 3
  /**
   * `seed` selects the phrasing variant deterministically, so the same question
   * always reads the same way. It is part of the CONTRACT, not an implementation
   * detail of the rules backend: it used to be smuggled through a
   * `backend as RulesBackend` cast at the call site, which meant any backend not
   * declaring a 4th parameter silently dropped it and fell back to `Date.now()`
   * — making replies non-reproducible on that path, with no test to catch it.
   */
  phraseResponse(
    intent: IntentResult,
    result: ResolveResult,
    ctx: AssistantContext,
    seed?: number,
    /** v10.38 — figures the previous turn was allowed to state (guard context). */
    prevAllowed?: readonly string[],
  ): Promise<string>; // stage 5
}

export interface AssistantTurn {
  reply: string;
  bucket: AssistantBucket | 'none';
  intentId: string;
  /** Capture only — seed for the existing TransactionFormModal (openAddTxn). */
  seed?: Partial<Transaction>;
  /** v10.39.1 (P21) — draft for the Recurring section's schedule sheet. */
  recurringSeed?: RecurringSeed;
  /**
   * Up to three one-tap follow-ups (#62). Already normalised and capped by
   * `runAssistant` — a renderer may show these verbatim without re-checking.
   * `undefined` means this turn offers none, which is normal.
   */
  chips?: AssistantChip[];
  /** True when the turn is a clarifying chip / fallback rather than an answer. */
  clarify: boolean;
  /**
   * v10.38 — the money-shaped figures this turn was allowed to state. The chat keeps
   * them on the message so the next turn's guard can accept a figure the user quotes
   * back when challenging this answer.
   */
  allowedFigures?: string[];
  /**
   * v10.47.0 — the outcome resolve() reached and, when it has them, its figures as
   * raw numbers (ResolveResult.amounts). WhatsApp uses it to send the affordability
   * card; the app ignores it.
   */
  resolved?: { outcome: string; amounts?: Record<string, number> };
}

// ── helpers ─────────────────────────────────────────────────────────────────
const cur = (ctx: AssistantContext) => ctx.baseCurrency;
const money = (n: number, ctx: AssistantContext) => fmt(Math.round(n), cur(ctx));

/**
 * The default period when the user names none — computed per question. v10.46.0: it
 * was a module constant, fixed when the file loaded, so a tab left open over a month
 * end (or a long-lived server isolate) kept answering "this month" for the old month.
 */
const currentPeriod = () => ({ monthKey: nowMonthKey(), label: 'this month', isCurrent: true } as const);

/** Local `YYYY-MM-DD`, as the ledger stores dates. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * v10.46.0 (#63) — the same stretch of LAST month: day 1 up to today's day number
 * (clamped to that month's length). "₹2,100 more than this point in August" compares
 * like with like; a full previous month against a part month always reads as "less".
 */
function samePointLastMonth(now = new Date()): { start: string; end: string; label: string } {
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const end = new Date(first.getFullYear(), first.getMonth(), Math.min(now.getDate(), lastDay));
  const monthName = first.toLocaleString('en-GB', { month: 'long' });
  return { start: isoDay(first), end: isoDay(end), label: `the same point in ${monthName}` };
}

/** Rolling monthly average expense for a category over the last `n` months
 *  (excluding the current month). Pure composition of `spendByCategory`. */
function categoryRollingAvg(ctx: AssistantContext, category: string, n = 3, excludeMonth = nowMonthKey()): number {
  const months = [...new Set(ctx.transactions.map(t => getMonthKey(t.date)))]
    .sort().filter(m => m !== excludeMonth).slice(-n);
  if (!months.length) return 0;
  const sum = months.reduce((s, mk) => s + (spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates)[category] || 0), 0);
  return sum / months.length;
}

/**
 * v10.38 — a money fact that may be NEGATIVE, stated with its direction in words.
 *
 * `money()` formats through `fmt`, which takes `Math.abs` for display, so
 * `money(-34956)` reads "₹34,956". A fact called `available_above_floor` carrying
 * that string told the model a household was ₹34,956 ABOVE a floor it was
 * ₹34,956 BELOW — a real number, correctly copied, and the opposite of the truth.
 * Any fact that can cross zero goes through here.
 */
/**
 * v10.48.1 — a category's budget for a month, in the base currency: its allocation in
 * that month's container budget (or a legacy per-category budget). Reading
 * `budgets.find(b => b.category === …)` found nothing for every v9.1 budget (TD-39's
 * class), so Pip said "no budget set" for a category that had one.
 */
function categoryBudget(ctx: AssistantContext, category: string, monthKey: string): { limit: number; estimated: boolean } | undefined {
  const lines = budgetLinesForMonth(ctx.budgets, ctx.budgetAllocations ?? [], monthKey).filter(b => b.category === category);
  if (!lines.length) return undefined;
  // A month's own line wins over an annual one covering the same category.
  const monthly = lines.filter(b => b.scope !== 'annual');
  const use = monthly.length ? monthly : lines;
  return {
    limit: use.reduce((sum, b) => sum + convert(b.limit, b.currency, cur(ctx), ctx.rates), 0),
    estimated: use.some(b => !!b.confidence && b.confidence !== 'confirmed'),
  };
}

const EXPENSE_IDS = new Set<string>(EXPENSE_CATEGORIES.map(c => c.id));

/** What a purchase is for: the category the model named, else one read from the words ("tea" → Food & Dining). */
function purchaseCategory(e: { category?: unknown; text?: unknown }): string | undefined {
  const named = resolveCategoryId(typeof e.category === 'string' ? e.category : undefined);
  const id = named ?? matchCategory(normalise(String(e.text ?? '')));
  return id && EXPENSE_IDS.has(id) && id !== 'loan_emi' ? id : undefined;
}

const signedMoney = (n: number, ctx: AssistantContext, up = 'above', down = 'below'): string =>
  `${money(Math.abs(n), ctx)} ${n < 0 ? down : up}`;

/**
 * Typical monthly spend and how many months it rests on — THE one baseline.
 * Cover, the emergency floor and every "your usual month" phrase divide by this.
 */
const basisOf = (ctx: AssistantContext) => ctx.summary.spendBasis;

/** How much history the averages rest on, in words the model can repeat. */
function basisLabel(ctx: AssistantContext): string {
  const b = basisOf(ctx);
  if (b.partialMonthOnly) return 'this month only — no completed month of history yet';
  return `${b.monthsConsidered} ${b.monthsConsidered === 1 ? 'completed month' : 'completed months'} of history`;
}

/**
 * Emergency-fund floor: three months of typical ESSENTIAL spending.
 *
 * v10.38 — needs, not everything. A floor built on total spend treats
 * discretionary spending as something you must keep funding through a crisis,
 * which overstates the cushion a household needs and made an affordable purchase
 * read as unaffordable. Both figures reach the model, so the answer can explain
 * which part is flexible.
 */
function emergencyFloor(ctx: AssistantContext): number {
  return basisOf(ctx).averageEssential * 3;
}

/**
 * The household position, shared by `interpret.status` and `forecast.prescriptive`.
 *
 * v10.38 — advice used to see only this month's categories, so "what should I do?"
 * could suggest trimming ₹54 from a household with a 95% savings rate and a
 * ₹25,45,000 mortgage at 8.75%. Advice needs the position, and the position is
 * already computed here.
 */
function positionFacts(ctx: AssistantContext) {
  const s = ctx.summary;
  return {
    net_worth: money(s.netWorth.netWorth, ctx),
    total_assets: money(s.netWorth.totalAssets, ctx),
    total_debt: money(s.netWorth.totalLiabilities, ctx),
    liquid_savings: money(s.netWorth.liquidAssets, ctx),
    // v10.39 (P4) — the same figure, decomposed. A total nobody can trace is a
    // figure the customer has to take on trust, and this one was wrong for months.
    liquid_by_source: liquidBySource(ctx),
    // v10.39.1 (P19) — what is actually FREE: the card bill comes out of the money
    // above. Signed, because dues can exceed the cash that will pay them.
    card_dues_to_pay: money(s.netWorth.cardDues, ctx),
    free_to_spend_after_card_dues: signedMoney(s.netWorth.liquidAssets - s.netWorth.cardDues, ctx, 'free', 'short'),
    months_of_liquid_cover: s.netWorth.liquidityMonths.toFixed(1),
    // v10.39.1 (P7) — Pulse scores this month's habits (budgets, savings RATE, trend,
    // debt). It says nothing about how long savings would last, so a 100/100 beside a
    // thin cushion is not a contradiction — but an answer must not read it as one.
    pulse_measures: "budgets, this month's savings rate, spending trend and debt — not how long your savings would last",
    ...(s.netWorth.liquidityMonths < 3
      ? { cushion_note: `liquid savings cover ${s.netWorth.liquidityMonths.toFixed(1)} months of typical spending, under the usual three-month cushion, whatever the Pulse score says` }
      : {}),
    cover_basis: `typical monthly spending of ${money(basisOf(ctx).averageMonthly, ctx)}, averaged over ${basisLabel(ctx)}`,
    income_this_month: money(s.thisMonth.income, ctx),
    spending_this_month: money(s.thisMonth.expense, ctx),
    savings_rate_this_month: `${Math.round(s.thisMonth.netSavingsRate * 100)}%`,
    pulse_score: s.pulseScore.total == null ? 'not enough data yet' : `${s.pulseScore.total}/100`,
    budgets_over_limit: s.budgets.filter(b => b.spentPct > 100).map(b => getCat(b.category).label),
    // v10.38.1 (P3) — raised, never silently corrected. Cash cannot be negative in
    // reality, so this means spending was recorded against cash that was never
    // recorded as received; the answer should say so rather than quietly absorbing it.
    ...(s.dataQuality?.cashBalanceNegative
      ? { data_warning: 'recorded cash is below zero — some cash received has not been entered' }
      : {}),
    largest_categories_this_month: s.thisMonth.topCategories.slice(0, 5)
      .map(t => ({ category: getCat(t.category).label, spent: money(t.amount, ctx) })),
  };
}

/**
 * The sentence shown when a capture pre-fills the form (v10.38, F7).
 *
 * Deterministic on purpose: it states exactly what was understood — amount,
 * category, date, account — and that nothing is recorded until the user saves.
 * A model adds nothing here (there are no facts to explain) and its output could
 * be discarded by the guard, leaving a form open with no explanation at all.
 */
/**
 * Every money-shaped figure this turn was allowed to state (v10.38).
 *
 * Kept on the transcript row so the NEXT turn's guard accepts a figure the user
 * quotes back when they challenge an answer. Same extraction the guard uses, so the
 * two cannot disagree.
 */
function figuresAllowedBy(result: ResolveResult): string[] {
  const source = JSON.stringify({ ...(result.vars ?? {}), facts: result.facts ?? {} });
  return [...new Set(source.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])];
}

function captureAcknowledgement(result: ResolveResult): string {
  const v = result.vars ?? {};
  const bits: string[] = [];
  if (v.amount) bits.push(v.converted_from
    ? `${String(v.amount)} (${String(v.converted_from)} at the app's exchange rate)`
    : String(v.amount));
  if (v.category) bits.push(`under ${String(v.category)}`);
  if (v.account) bits.push(`on ${String(v.account)}`);
  if (v.date) bits.push(`dated ${String(v.date)}`);
  const what = bits.length ? bits.join(' ') : 'the details you gave';
  return `I've pre-filled ${what}. Check it over and save it — nothing is recorded until you do.`;
}

/** v10.39.1 (P21) — the recurring counterpart: what was understood, and what is left to do. */
function recurringAcknowledgement(result: ResolveResult): string {
  const v = result.vars ?? {};
  const amount = v.converted_from
    ? `${String(v.amount)} (${String(v.converted_from)} at the app's exchange rate)`
    : String(v.amount);
  const when = v.day ? ` on the ${String(v.day)}` : '';
  return `I've drafted a ${String(v.frequency)} schedule for ${amount} under ${String(v.category)}${when}. `
    + 'Choose the account it comes from and save it — nothing is set up until you do.';
}

// ── v10.39.1 (P17) — replies that need no model ─────────────────────────────────
//
// "Hi" took as long as a net-worth question: two model calls, through a queue, to
// say hello. These answers read no household data and contain no figures, so they
// are written here and returned at once — and they still work when the model is
// unreachable, which is honest: nothing about the household is being answered.
// Matched against the WHOLE message, so "hi, how much did I spend?" is still a
// question and goes to the model.
const QUICK_CHIPS: AssistantChip[] = [
  { label: 'Spend this month', prompt: 'How much did I spend this month?' },
  { label: 'How am I doing?', prompt: 'How am I doing financially?' },
  { label: 'Upcoming bills', prompt: 'What are my upcoming bills?' },
];

/** What Ask Vyact does, grouped the way the receptionist offers it (design: InAppCalm). */
function capabilitySummary(): string {
  return 'Record — a spend, income, a transfer, a split, or a bill that repeats.\n'
    + 'Check — what you spent, where it went, your budgets, what is due.\n'
    + 'Plan — whether a purchase fits, how long savings last, where to cut back.';
}

/** A quick reply: the text, and the chips to offer after it (none on a close). */
export interface QuickReply { reply: string; chips?: AssistantChip[] }

/**
 * v10.41.0 — the RECEPTIONIST (design: "Vyact receptionist and button replies").
 *
 * A greeting used to get a generic line and the same three chips for everyone. It is
 * the most common way a conversation starts, so it is now the entry point: it asks
 * what the person wants to do and offers the three most useful next steps FOR THIS
 * HOUSEHOLD, from data the app already holds on the device. No model call; any
 * figure comes from the same calculations as the rest of the app.
 *
 *   chip 1  the most frequent action: Log an expense
 *   chip 2  a bill due in the next 7 days → "What's due this week", else Spend this month
 *   chip 3  a budget over 80% → "Why is <category> high?", else How am I doing?
 *   new household (nothing recorded): Log an expense · Add an account · What can you do?
 */
export function receptionist(salutation: string, ctx?: AssistantContext): QuickReply {
  const first = (ctx?.profile?.name ?? '').trim().split(/\s+/)[0];
  const hello = first ? `${salutation}, ${first}.` : `${salutation}.`;
  if (!ctx || ctx.transactions.length === 0) {
    return {
      reply: `${hello} I'm Pip. I keep your household's money straight, from what you record here.\n`
        + "Nothing's recorded yet, so let's start with one thing.",
      chips: [
        { label: 'Log an expense', prompt: 'Log an expense' },
        { label: 'Add an account', prompt: 'Add an account' },
        { label: 'What can you do?', prompt: 'What can you do?' },
      ],
    };
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today); weekOut.setDate(weekOut.getDate() + 7);
  const bill = (ctx.recurring ?? [])
    .filter(r => r.active && r.transactionTemplate.type === 'expense')
    .map(r => ({ r, due: new Date(`${r.nextDueDate}T00:00:00`) }))
    .filter(x => x.due >= today && x.due <= weekOut)
    .sort((a, b) => a.due.getTime() - b.due.getTime())[0];
  const hot = [...ctx.summary.budgets].filter(b => b.spentPct > 80).sort((a, b) => b.spentPct - a.spentPct)[0];
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysLeft = Math.max(0, Math.round((monthEnd.getTime() - today.getTime()) / 86_400_000));
  const weekday = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long' });

  const billText = bill
    ? `${bill.r.transactionTemplate.description || getCat(bill.r.transactionTemplate.category).label}, ${money(bill.r.transactionTemplate.amount, ctx)}, is due ${bill.due.getTime() === today.getTime() ? 'today' : weekday(bill.due)}`
    : '';
  const hotLabel = hot ? getCat(hot.category).label : '';
  const hotText = hot ? `${hotLabel} is at ${Math.round(hot.spentPct)}% of its budget with ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to go` : '';
  const context = bill && hot ? `${billText}, and ${hotText}.`
    : bill ? `${billText}.`
    : hot ? `${hotText}.`
    : "Nothing's due this week and your budgets are on track.";

  return {
    reply: `${hello} What would you like to do?\n${context.charAt(0).toUpperCase()}${context.slice(1)}`,
    chips: [
      { label: 'Log an expense', prompt: 'Log an expense' },
      bill
        ? { label: "What's due this week", prompt: 'What bills are due this week?' }
        : { label: 'Spend this month', prompt: 'How much did I spend this month?' },
      hot
        ? { label: `Why is ${hotLabel} high?`, prompt: `Why is my ${hotLabel.toLowerCase()} spending so high?` }
        : { label: 'How am I doing?', prompt: 'How am I doing financially?' },
    ],
  };
}

/**
 * Replies that need no model: greetings (the receptionist), thanks, who-are-you,
 * what-can-you-do, and the two entry actions the receptionist offers. Matched
 * against the WHOLE message, so "hi, how much did I spend?" is still a question.
 */
export function quickReply(utterance: string, ctx?: AssistantContext): QuickReply | null {
  const t = normalise(utterance).replace(/[!?.,:;~*]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\s+(vyact|ask vyact|there|buddy|team)$/, '');
  if (!t) return null;
  const greeting = t.match(/^(?:hi|hii+|hello|hey|hiya|namaste|namaskar|yo|menu|start|good (morning|afternoon|evening))$/);
  if (greeting) {
    const part = greeting[1];
    return receptionist(part ? part.charAt(0).toUpperCase() + part.slice(1) : 'Hi', ctx);
  }
  if (/^(thanks|thank you|thank u|thx|ty|ok thanks|okay thanks|thanks a lot|great thanks|cool|great|ok|okay|got it|perfect|nice)$/.test(t)) {
    return { reply: "Any time. I'm here when you need me." };
  }
  if (/^(who are you|what('?s| is) your name|what (do|should|can) i call you|your name|are you (a )?(real )?(person|human|bot))$/.test(t)) {
    return { reply: "I'm Pip, the assistant built into Vyact. I work from your own records, and anything I'm unsure about, I ask rather than guess.", chips: QUICK_CHIPS };
  }
  if (/^(help|what can you do|what else can you do|what do you do|how can you help( me)?|what can i ask( you)?|what can you help (me )?with)$/.test(t)) {
    return { reply: capabilitySummary(), chips: QUICK_CHIPS };
  }
  if (/^(log|add|record) (an |a )?(expense|spend)$/.test(t)) {
    return { reply: "Tell me like you'd tell a friend. For example:\n450 lunch\n1200 groceries on hdfc\nspent 800 on fuel yesterday\nI'll fill in the form. Nothing is saved until you check it." };
  }
  if (/^add (an |a )?account$/.test(t)) {
    return { reply: 'Accounts live on the Accounts screen: Plan › Accounts › Add account. Add the bank or card you spend from most, with its balance today, and the rest follows.' };
  }
  return null;
}

/**
 * v10.39.1 (P17) — `meta.assistant` answered without a phrase call. The facts it
 * used to send the model were the capability list and a name; the model added
 * seconds and nothing else.
 */
function aboutMeReply(text: string): string {
  const t = normalise(text);
  if (/\b(slow|fast|quick|long|wait|lag|delay|taking)\b/.test(t)) {
    return 'Each answer takes two steps: I work out your figures from your own records, then a language model writes the reply. '
      + 'The writing step can take several seconds, longer when the service is busy. Greetings and questions about me are answered instantly.';
  }
  if (/\b(bullet|format|table|shorter|longer|brief|concise|detail|style|tone)\b/.test(t)) {
    return "I can't change how my answers are formatted on request yet. "
      + 'I lead with the figure you asked for and keep the rest short.';
  }
  return `I'm Pip. Here's what I do:\n${capabilitySummary()}`;
}

/**
 * WHERE the liquid money sits (v10.39, P4).
 *
 * The parts come from the same rows the projection totalled, so this breakdown
 * cannot disagree with `liquid_savings`. Largest first, because the answer to
 * "where is it?" is usually the top one or two.
 */
function liquidBySource(ctx: AssistantContext) {
  return ctx.summary.holdings
    .filter(h => h.liquidity === 'liquid')
    .sort((a, b) => b.value - a.value)
    .map(h => ({ held_in: h.name, amount: money(h.value, ctx), kind: h.source }));
}

/** Everything owned, grouped by how quickly it could be reached (v10.39, P4). */
function assetsByLiquidity(ctx: AssistantContext) {
  const LABEL = { liquid: 'reachable now', short: 'a few days or weeks', long: 'locked up or slow to sell' };
  return ctx.summary.holdings
    .slice()
    .sort((a, b) => b.value - a.value)
    .map(h => ({ holding: h.name, value: money(h.value, ctx), how_soon: LABEL[h.liquidity] }));
}

/**
 * Spending grouped by the account it left (v10.39, P4).
 *
 * Every spend carries its account, but nothing ever aggregated by it, so "which card
 * am I using most?" was unanswerable while the data sat right there. Rows with no
 * account recorded are reported as such rather than silently dropped — a total that
 * quietly omits part of the spending is the failure mode this release exists to stop.
 */
function spendByAccount(ctx: AssistantContext, monthKey: string) {
  return spendByAccountWhere(ctx, date => getMonthKey(date) === monthKey);
}

/**
 * v10.46.0 — by account, counted exactly as the period totals are: reportable rows
 * only, each at its effective amount in the household currency. It used to add the
 * raw `amount` of every expense, so a PRIVATE entry was counted, a split counted in
 * full instead of your share, and a foreign amount was added unconverted — beside a
 * period total that did none of those. Two figures about the same money disagreed.
 */
function spendByAccountWhere(ctx: AssistantContext, inWindow: (date: string) => boolean) {
  const names = new Map((ctx.accounts ?? []).map(a => [a.id, a.name]));
  const totals = new Map<string, number>();
  for (const t of reportableTxns(ctx.transactions)) {
    if (t.type !== 'expense' || !inWindow(t.date)) continue;
    const key = t.accountId ? (names.get(t.accountId) ?? 'another account') : 'no account recorded';
    totals.set(key, (totals.get(key) ?? 0) + effectiveAmount(t, cur(ctx), ctx.rates));
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([paid_from, amount]) => ({ paid_from, spent: money(amount, ctx) }));
}

/**
 * Debts, highest rate first — shared by `interpret.debts` and advice.
 *
 * SafeSummary debts carry a TYPE, never the user's own name for the debt: that is
 * deliberate egress minimisation, so the label comes from the type.
 */
function debtFacts(ctx: AssistantContext) {
  return [...ctx.summary.debts]
    .sort((a, b) => b.aprPct - a.aprPct)
    .map(d => ({
      debt: getCat(d.type).label || d.type,
      balance: money(d.balance, ctx),
      interest_rate: `${d.aprPct}%`,
      months_remaining: d.monthsRemaining != null ? String(d.monthsRemaining) : 'not set',
    }));
}

/** Does this category lean on onboarding estimates? (provenance, spec §5). */
function categoryUsesEstimate(ctx: AssistantContext, category: string): boolean {
  if (categoryBudget(ctx, category, nowMonthKey())?.estimated) return true;
  return ctx.transactions.some(t => t.category === category && t.confidence && t.confidence !== 'confirmed');
}

/**
 * v10.36 — every category spent in this month, largest first, with its usual
 * (rolling average) and the gap, pre-formatted for the model.
 *
 * Several intents used to compute exactly this and then keep only the single top
 * or worst category, which is why "where can I cut back?" could name just one.
 * Amounts go through `money()` so the model can cite them verbatim and pass
 * assertNoInventedFigures. Category LABELS only — never descriptions or merchant
 * text, which SafeSummary deliberately excludes from egress.
 */
function categoryBreakdown(ctx: AssistantContext, monthKey = nowMonthKey()) {
  const spend = spendByCategory(ctx.transactions, monthKey, cur(ctx), ctx.rates);
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  // v10.46.0 — how many entries and what share of the period each category is, so
  // "most of it went on food" can be said with its number rather than guessed.
  const entries = new Map<string, number>();
  for (const t of reportableTxns(ctx.transactions)) {
    if (t.type === 'expense' && getMonthKey(t.date) === monthKey) entries.set(t.category, (entries.get(t.category) ?? 0) + 1);
  }
  return Object.entries(spend)
    .sort(([, a], [, b]) => b - a)
    .map(([c, amt]) => {
      // "Usual" always excludes the month being reported, so a past month is
      // compared with its neighbours rather than with itself.
      const usual = categoryRollingAvg(ctx, c, 3, monthKey);
      const gap = amt - usual;
      const nw = NEEDS_WANTS_MAP[c];
      return {
        category: getCat(c).label,
        spent: money(amt, ctx),
        entries: String(entries.get(c) ?? 0),
        share_of_period: total > 0 ? `${Math.round((amt / total) * 100)}%` : '0%',
        usual_month: usual > 0 ? money(usual, ctx) : 'no history yet',
        compared_with_usual: usual > 0
          ? (gap >= 0 ? `${money(gap, ctx)} above` : `${money(-gap, ctx)} below`)
          : 'no history yet',
        kind: nw === 'want' ? 'discretionary' : nw === 'need' ? 'essential' : 'unclassified',
      };
    });
}

/**
 * v10.46.0 (#65) — how steadily the household records: consecutive days with at
 * least one entry, ending today (or yesterday, when today has nothing yet — a
 * streak is not broken before the day is over), and days recorded this month.
 */
function loggingFacts(ctx: AssistantContext, now = new Date()) {
  const days = new Set(ctx.transactions.map(t => t.date));
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(isoDay(cursor))) cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  let streak = 0;
  while (days.has(isoDay(cursor)) && streak < 3660) {
    streak += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  const monthPrefix = isoDay(now).slice(0, 8);
  const loggedThisMonth = [...days].filter(d => d.startsWith(monthPrefix) && d <= isoDay(now)).length;
  return {
    logging_streak: streak > 0 ? `${streak} ${streak === 1 ? 'day' : 'days'} running` : 'nothing recorded yesterday or today',
    days_recorded_this_month: `${loggedThisMonth} of ${now.getDate()}`,
  };
}

/**
 * v10.46.0 (#63) — this month so far against the SAME point last month, for the
 * total or one category. With no spending recorded last month there is no
 * comparison to make, and it says so rather than reporting "₹X more than ₹0".
 */
function samePointFacts(ctx: AssistantContext, amountNow: number, category?: string) {
  const sp = samePointLastMonth();
  const spend = spendByCategoryInRange(ctx.transactions, sp.start, sp.end, cur(ctx), ctx.rates);
  const then = category ? (spend[category] || 0) : Object.values(spend).reduce((a, b) => a + b, 0);
  if (then <= 0) return { same_point_last_month: 'nothing recorded at that point last month' };
  return {
    same_point_last_month: money(then, ctx),
    same_point_is: sp.label,
    compared_with_same_point: signedMoney(amountNow - then, ctx, 'more', 'less'),
  };
}

/** v10.46.0 — spending over a window shorter than a month ("today", "this week"). */
function lookupWindow(ctx: AssistantContext, span: { start: string; end: string; label: string }, rawCategory?: string): ResolveResult {
  const spend = spendByCategoryInRange(ctx.transactions, span.start, span.end, cur(ctx), ctx.rates);
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  const inWindow = (d: string) => d >= span.start && d <= span.end;
  const counts = new Map<string, number>();
  for (const t of reportableTxns(ctx.transactions)) {
    if (t.type === 'expense' && inWindow(t.date)) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  }
  const entryCount = [...counts.values()].reduce((a, b) => a + b, 0);
  const rows = Object.entries(spend).sort(([, a], [, b]) => b - a).map(([c, amt]) => ({
    category: getCat(c).label,
    spent: money(amt, ctx),
    entries: String(counts.get(c) ?? 0),
    share_of_period: total > 0 ? `${Math.round((amt / total) * 100)}%` : '0%',
  }));
  const base = {
    period: span.label,
    from: span.start,
    to: span.end,
    total_spent: money(total, ctx),
    entries: String(entryCount),
    categories_in_period: rows,
    spend_by_account: spendByAccountWhere(ctx, inWindow),
  };
  const chips: AssistantChip[] = [{ label: 'This month so far', prompt: 'how much have I spent this month' }];
  if (rawCategory) {
    const category = resolveCategoryId(rawCategory);
    if (!category) {
      return { kind: 'interpret', outcome: 'needs_category', facts: { requested_category: rawCategory, ...base },
        analysis: [`Could not place the category "${rawCategory}"`], vars: { category: rawCategory } };
    }
    const amount = spend[category] || 0;
    return { kind: 'interpret', outcome: 'ok', chips,
      facts: { ...base, asked_about: getCat(category).label, spent: money(amount, ctx), entries_in_category: String(counts.get(category) ?? 0) },
      analysis: [`Totalled ${getCat(category).label} for ${span.label}`],
      vars: { amount: money(amount, ctx), category: getCat(category).label.toLowerCase(), period: span.label } };
  }
  return { kind: 'interpret', outcome: total > 0 ? 'period_total' : 'no_activity', chips, facts: base,
    analysis: [`Totalled ${span.label}'s spending across ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`],
    vars: { amount: money(total, ctx), period: span.label } };
}

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** v10.39.1 (P21) — the recurring draft, from what the user actually said. */
function recurringSeedFrom(e: IntentResult['entities']): RecurringSeed {
  const text = e.text;
  const stated = String(e.frequency ?? '').toLowerCase();
  const frequency: RecurringSeed['frequency'] =
    /daily|every day/.test(stated || text) ? 'daily'
    : /week/.test(stated || text) ? 'weekly'
    : /year|annual/.test(stated || text) ? 'yearly'
    : 'monthly';
  const type: RecurringSeed['type'] = /\b(salary|paycheck|pay ?day|income|stipend|pension|rent (received|income))\b/.test(text)
    ? 'income' : 'expense';
  const category = resolveCategoryId(typeof e.category === 'string' ? e.category : undefined)
    ?? matchCategory(String(e.merchant ?? text).toLowerCase())
    ?? (type === 'income' ? 'salary' : 'other_expense');
  // A day only when it is unambiguous: the entity, or an ordinal in the text
  // ("on the 5th") — never a bare number, which is usually the amount.
  const fromText = text.match(/\b([1-9]|[12]\d|3[01])(st|nd|rd|th)\b/);
  const rawDay = typeof e.dayOfMonth === 'number' ? e.dayOfMonth : fromText ? Number(fromText[1]) : undefined;
  const dayOfMonth = frequency === 'monthly' && rawDay && rawDay >= 1 && rawDay <= 31 ? Math.trunc(rawDay) : undefined;
  const name = e.merchant
    ? e.merchant.charAt(0).toUpperCase() + e.merchant.slice(1)
    : getCat(category).label;
  return { name, type, amount: e.amount ?? 0, category, frequency, ...(dayOfMonth ? { dayOfMonth } : {}) };
}

/** Intents whose `amount` entity is a sum of money the user stated. */
const AMOUNT_INTENTS = new Set([
  'capture.expense', 'capture.income', 'capture.transfer', 'capture.investment',
  'capture.split', 'capture.recurring', 'forecast.affordability', 'forecast.prescriptive',
]);

/** A rate exists for this code. USD is the table's anchor, so it always does. */
const hasRate = (rates: AssistantContext['rates'], code: string) =>
  code === 'USD' || (typeof rates[code] === 'number' && rates[code] > 0);

// ── Stage 4 — resolve (the ONLY place money is computed) ────────────────────────
/**
 * v10.39.1 — two checks on the stated AMOUNT before any figure is computed.
 *
 * P8: an amount that only ever appears in the text as a phone/account/reference
 * number is not an amount. Capture asks for one instead of pre-filling it.
 *
 * P20: an amount stated in another currency is converted to the base currency
 * FIRST, at the app's own rate — or, when the app holds no rate for it, not used at
 * all. "$150 dinner" was checked as ₹150 because the currency was read and dropped.
 * `convert()` quietly treats a missing rate as 1, which is how a wrong answer would
 * come back; so the rate's existence is checked here, explicitly, and a missing one
 * is said out loud with no figures.
 */
export function resolve(intent: IntentResult, ctx: AssistantContext): ResolveResult {
  const e = intent.entities;
  if (!AMOUNT_INTENTS.has(intent.id) || e.amount == null) return resolveCore(intent, ctx);
  const kind: ResolveResult['kind'] = intent.id.startsWith('capture') ? 'capture' : 'forecast';

  if (kind === 'capture' && amountLooksLikeIdentifier(normalise(e.text), e.amount)) {
    return {
      kind, outcome: 'missing_amount', vars: {},
      facts: { needs: 'the amount', note: 'the only number given looks like a phone, account or reference number, not an amount' },
      analysis: ['The number given looks like a phone or account number, not an amount'],
    };
  }

  const base = cur(ctx);
  const stated = statedCurrency(e.currency, e.text, base, CURRENCIES[base]?.symbol);
  if (!stated || stated === base) return resolveCore(intent, ctx);

  if (!hasRate(ctx.rates, stated) || !hasRate(ctx.rates, base)) {
    return {
      kind, outcome: 'needs_rate', vars: {},
      facts: {
        amount_currency: stated,
        household_currency: base,
        note: `no exchange rate for ${stated} is set in the app, so this amount cannot be converted to ${base}; add the rate in Settings, or ask again in ${base}`,
      },
      analysis: [`No ${stated} → ${base} rate is set, so I can't convert this amount`],
    };
  }

  const converted = Math.round(convert(e.amount, stated, base, ctx.rates) * 100) / 100;
  const rate = convert(1, stated, base, ctx.rates);
  const asStated = `${e.amount} ${stated}`;
  const rateText = `1 ${stated} = ${rate.toFixed(rate >= 1 ? 2 : 4)} ${base}, the rate set in the app`;
  const result = resolveCore({ ...intent, entities: { ...e, amount: converted } }, ctx);
  return {
    ...result,
    vars: { ...result.vars, converted_from: asStated },
    facts: { ...(result.facts ?? {}), amount_as_stated: asStated, converted_at: rateText },
    analysis: [`Converted ${asStated} to ${base} at ${rateText.split(',')[0]}`, ...(result.analysis ?? [])],
  };
}

function resolveCore(intent: IntentResult, ctx: AssistantContext): ResolveResult {
  const e = intent.entities;

  switch (intent.id) {
    // ── Capture ───────────────────────────────────────────────────────────────
    case 'capture.expense':
    case 'capture.income':
    case 'capture.transfer':
    case 'capture.investment': {
      if (e.amount == null) {
        // No chips. The deck answers this case with three amounts drawn from
        // this user's own spend history ("₹200 · ₹500 · ₹1,000") — that needs
        // #70. The old `{ label: 'Add details' }` placeholder asked nothing, so
        // it could only ever have been a dead end had it reached a screen.
        return { kind: 'capture', outcome: 'missing_amount', vars: {} };
      }
      const type: TxnType = intent.id === 'capture.income' ? 'income'
        : intent.id === 'capture.transfer' ? 'transfer'
        : intent.id === 'capture.investment' ? 'investment' : 'expense';
      // v9 §3 — transfer-class rows carry no category ('' → null at the adapter).
      const transferClass = type === 'transfer' || type === 'investment';
      // v10.38 (F6) — a merchant the user or a bank message named is a category
      // signal, and KEYWORD_MAP already knows the common ones (swiggy → food_dining).
      // Without this, a pasted card alert filed every spend under "other", so the
      // user's category totals silently drifted with every SMS they forwarded.
      const category = transferClass ? ''
        : (e.category
          ?? (type === 'expense' ? matchCategory(String(e.merchant ?? '').toLowerCase()) : undefined)
          ?? (type === 'income' ? 'salary' : 'other_expense'));
      // The date and the account the message stated. Both were extracted and then
      // dropped, so a bank paste still made the user retype the date and pick the card.
      const statedDate = parseDateEntity(typeof e.date === 'string' ? e.date : undefined);
      const accountId = matchAccountId(typeof e.account === 'string' ? e.account : undefined, ctx.accounts ?? []);
      const accountName = accountId ? (ctx.accounts ?? []).find(a => a.id === accountId)?.name : undefined;
      const seed: Partial<Transaction> = {
        type, amount: e.amount, category,
        description: e.merchant ? e.merchant.charAt(0).toUpperCase() + e.merchant.slice(1) : '',
        ...(statedDate ? { date: statedDate } : {}),
        ...(accountId ? { accountId } : {}),
      };
      return {
        kind: 'capture', outcome: 'seeded', seed,
        vars: {
          amount: money(e.amount, ctx),
          category: transferClass
            ? (type === 'investment' ? 'investment' : 'transfer')
            : getCat(category).label.toLowerCase(),
          ...(statedDate ? { date: statedDate } : {}),
          ...(accountName ? { account: accountName } : {}),
        },
      };
    }
    case 'capture.split': {
      if (e.amount == null) {
        // No chips. The deck answers this case with three amounts drawn from
        // this user's own spend history ("₹200 · ₹500 · ₹1,000") — that needs
        // #70. The old `{ label: 'Add details' }` placeholder asked nothing, so
        // it could only ever have been a dead end had it reached a screen.
        return { kind: 'capture', outcome: 'missing_amount', vars: {} };
      }
      const ways = e.participantCount ?? 2;
      const share = Math.round((e.amount / ways) * 100) / 100;
      const split: SplitInfo = {
        isSplit: true, totalAmount: e.amount, yourShare: share, paidBy: 'me',
        participants: Array.from({ length: ways }, (_, i) => ({
          name: i === 0 ? 'me' : `Person ${i + 1}`, isYou: i === 0, share, paid: i === 0,
        })),
      };
      const seed: Partial<Transaction> = {
        type: 'expense', amount: e.amount, category: e.category ?? 'food_dining',
        description: e.merchant ? e.merchant.charAt(0).toUpperCase() + e.merchant.slice(1) : 'Split',
        split,
      };
      return {
        kind: 'capture', outcome: 'seeded', seed,
        vars: { amount: money(e.amount, ctx), ways, share: money(share, ctx) },
      };
    }
    // v10.39.1 (P21) — a REPEATING bill, proposed to the Recurring section's own form.
    // Nothing is scheduled here: the user picks the paying account and saves, exactly
    // as for a one-off capture. v9.1 made Recurring the only place a schedule is
    // authored, and this keeps it so — chat only fills the draft in.
    case 'capture.recurring': {
      if (e.amount == null) return { kind: 'capture', outcome: 'missing_amount', vars: {} };
      const seed = recurringSeedFrom(e);
      return {
        kind: 'capture', outcome: 'recurring_seeded', recurringSeed: seed,
        vars: {
          amount: money(seed.amount, ctx),
          category: getCat(seed.category).label.toLowerCase(),
          frequency: seed.frequency,
          ...(seed.dayOfMonth ? { day: ordinal(seed.dayOfMonth) } : {}),
        },
      };
    }

    // ── Interpret ───────────────────────────────────────────────────────────────
    case 'interpret.lookup': {
      // v10.38 (F1/F5) — the PERIOD the user named is honoured, and a question with
      // no category returns the period TOTAL.
      //
      // 🔴 What this replaced: the month was hard-coded to `nowMonthKey()` and an
      // absent category fell back to the biggest one. So "how much on food in
      // August" answered with THIS month's food figure under an August label, and
      // "how much did I spend this month?" answered for Rent alone with no total.
      // Both are true numbers answering a question nobody asked, and the
      // invented-figure guard cannot see the difference. When a stated period
      // cannot be placed we now say so instead of substituting today.
      const stated = typeof e.period === 'string' ? e.period : undefined;
      // v10.46.0 — a window shorter than a month ("today", "this week"), answered over
      // its own dates. It used to fall to needs_period, or worse, to the month.
      const span = resolveDayWindow(stated);
      if (span) return lookupWindow(ctx, span, typeof e.category === 'string' ? e.category : undefined);
      const period = resolvePeriod(stated) ?? (stated ? null : currentPeriod());
      if (!period) {
        return {
          kind: 'interpret', outcome: 'needs_period',
          facts: { requested_period: String(stated), can_answer_for: 'this month or a named past month' },
          analysis: [`Could not place the period "${stated}"`],
          vars: { period: String(stated) },
        };
      }
      const mk = period.monthKey;
      const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
      const breakdown = categoryBreakdown(ctx, mk);
      const total = Object.values(spend).reduce((a, b) => a + b, 0);

      // No category named ⇒ the question is about the whole period.
      if (!e.category) {
        return {
          kind: 'interpret', outcome: breakdown.length ? 'period_total' : 'no_activity',
          chips: [
            { label: 'Where is it going?', prompt: 'where is my money going' },
            { label: 'Which budgets are at risk?', prompt: 'which budgets are at risk' },
          ],
          facts: {
            period: period.label,
            total_spent: money(total, ctx),
            categories_in_period: breakdown,
            spend_by_account: spendByAccount(ctx, mk),
            category_count: String(breakdown.length),
            ...(period.isCurrent ? samePointFacts(ctx, total) : {}),
          },
          analysis: [
            `Totalled ${period.label}'s spending across ${breakdown.length} ${breakdown.length === 1 ? 'category' : 'categories'}`,
          ],
          vars: { amount: money(total, ctx), period: period.label },
        };
      }

      // v10.38.1 (P6) — the model names a category in the customer's words
      // ("food"); the ledger is keyed by id (`food_dining`). Resolve, or ask.
      const category = resolveCategoryId(e.category);
      if (!category) {
        return {
          kind: 'interpret', outcome: 'needs_category',
          facts: { requested_category: String(e.category), period: period.label,
            categories_in_period: breakdown },
          analysis: [`Could not place the category "${String(e.category)}"`],
          vars: { category: String(e.category) },
        };
      }
      const amount = spend[category] || 0;
      const budget = categoryBudget(ctx, category, mk);
      const usesEstimate = categoryUsesEstimate(ctx, category);
      // The deck's canonical example of the rule: after a figure, the next
      // question is "why", never "open reports".
      const lookupChips: AssistantChip[] = [
        { label: 'Why is it up?', prompt: `why is my ${getCat(category).label.toLowerCase()} spending so high` },
        { label: 'Where else is it going?', prompt: 'where is my money going' },
      ];
      const label = getCat(category).label;
      const facts = {
        period: period.label,
        asked_about: label,
        spent: money(amount, ctx),
        budget: budget && budget.limit > 0 ? money(budget.limit, ctx) : 'no budget set',
        share_of_budget: budget && budget.limit > 0 ? `${Math.round((amount / budget.limit) * 100)}%` : 'no budget set',
        usual_month: breakdown.find(r => r.category === label)?.usual_month ?? 'no history yet',
        total_spent_in_period: money(total, ctx),
        every_category_in_period: breakdown,
        spend_by_account: spendByAccount(ctx, mk),
        ...(period.isCurrent ? samePointFacts(ctx, amount, category) : {}),
      };
      const analysis = [
        `Totalled ${period.label}'s spending across ${breakdown.length} ${breakdown.length === 1 ? 'category' : 'categories'}`,
        budget && budget.limit > 0 ? `Compared ${label} with its budget` : `Compared ${label} with your usual month`,
      ];
      if (budget && budget.limit > 0) {
        return {
          kind: 'interpret', outcome: 'vs_budget', usesEstimate, chips: lookupChips, facts, analysis,
          vars: {
            amount: money(amount, ctx), category: getCat(category).label.toLowerCase(),
            pct: `${Math.round((amount / budget.limit) * 100)}%`, budget: money(budget.limit, ctx),
          },
        };
      }
      return {
        kind: 'interpret', outcome: 'ok', usesEstimate, chips: lookupChips, facts, analysis,
        vars: { amount: money(amount, ctx), category: getCat(category).label.toLowerCase() },
      };
    }
    // v10.38 (F9) — about the assistant, not the money. Reads NOTHING from the
    // household: no summary, no transactions, no budgets. "What do I call you?"
    // used to route to interpret.status and send the user's net worth, debts and
    // budgets to the model to answer a question about a name.
    case 'meta.assistant':
      return {
        kind: 'interpret', outcome: 'about_me',
        facts: { assistant_name: 'Pip', ...CAPABILITIES },
        analysis: ['Answered about myself — no household data read'],
        vars: {},
      };
    // v10.39.1 (P22) — asked to DO something the app cannot. Said plainly, with the
    // list of what does work, and no household data read: forcing these into the
    // nearest money intent produced a confident answer to a different question.
    case 'unsupported':
      return {
        kind: 'fallback', outcome: 'unsupported',
        facts: { request: 'something I cannot do from here', ...CAPABILITIES },
        analysis: ["That's outside what I can do — listing what I can"],
        vars: {},
      };
    case 'interpret.status': {
      const s = ctx.summary;
      // One overview serves all three branches: net worth, balances and "how am I
      // doing" are the same question at different zoom levels, and each used to
      // get a single pre-written sentence.
      const facts = { ...positionFacts(ctx), ...loggingFacts(ctx) };
      const analysis = [
        'Read your net worth, assets and debt',
        "Compared this month's income with your spending",
        `Checked ${s.budgets.length} ${s.budgets.length === 1 ? 'budget' : 'budgets'} and your largest categories`,
      ];
      if (/net ?worth|wealth/.test(e.text)) {
        return { kind: 'interpret', outcome: 'ok', facts, analysis, vars: {
          headline: `Your net worth is ${money(s.netWorth.netWorth, ctx)}.`,
          detail: `That's ${money(s.netWorth.totalAssets, ctx)} in assets minus ${money(s.netWorth.totalLiabilities, ctx)} of debt, with about ${s.netWorth.liquidityMonths.toFixed(1)} months of liquid cover.`,
        } };
      }
      if (/balance/.test(e.text)) {
        return { kind: 'interpret', outcome: 'ok', facts, analysis, vars: {
          headline: `You've got about ${money(s.netWorth.totalAssets, ctx)} across your accounts.`,
          detail: `Roughly ${s.netWorth.liquidityMonths.toFixed(1)} months of expenses in liquid savings.`,
        } };
      }
      const total = s.pulseScore.total ?? 0;
      // v10.39.1 (P7) — "Strong — keep doing what you are doing" was said beside 1.7
      // months of cover. Pulse does not measure the cushion, so the verdict line must
      // not speak for it: a strong score with a thin cushion says both.
      const thinCushion = s.netWorth.liquidityMonths < 3 && total >= 65;
      return { kind: 'interpret', outcome: 'ok', facts, analysis, vars: {
        headline: `Your Pulse Score is ${total}/100.`,
        detail: thinCushion
          ? `Your monthly habits score well, but your cushion is thin — about ${s.netWorth.liquidityMonths.toFixed(1)} months of cover.`
          : total >= 80 ? 'Strong — keep doing what you are doing.'
          : total >= 65 ? 'Solid, with a little room to push.'
          : 'There is room to improve — Insights lists your next steps.',
      } };
    }
    case 'interpret.diagnostic': {
      const mk = nowMonthKey();
      const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
      // Biggest category vs its rolling average — the deterministic "why".
      let worst: { cat: string; now: number; avg: number; delta: number } | null = null;
      for (const [c, amt] of Object.entries(spend)) {
        const avg = categoryRollingAvg(ctx, c);
        const delta = amt - avg;
        if (avg > 0 && delta > 0 && (!worst || delta > worst.delta)) worst = { cat: c, now: amt, avg, delta };
      }
      const breakdown = categoryBreakdown(ctx);
      const compared = `Compared each of ${breakdown.length} ${breakdown.length === 1 ? 'category' : 'categories'} with its usual month`;
      if (worst && worst.delta / Math.max(worst.avg, 1) >= 0.2) {
        const pct = Math.round((worst.delta / worst.avg) * 100);
        // The chips deliberately exclude "Why so high?" — this reply has just
        // said why, and the deck bans a chip that repeats the answer.
        return { kind: 'interpret', outcome: 'found', usesEstimate: categoryUsesEstimate(ctx, worst.cat),
          facts: {
            every_category_this_month: breakdown,
            spend_by_account: spendByAccount(ctx, mk),
            biggest_rise: {
              category: getCat(worst.cat).label,
              spent: money(worst.now, ctx),
              usual_month: money(worst.avg, ctx),
              above_usual: `${pct}%`,
            },
          },
          analysis: [compared, `${getCat(worst.cat).label} is furthest above its usual`],
          vars: {
            headline: `${getCat(worst.cat).label} is ${pct}% above your usual.`,
            detail: `It's at ${money(worst.now, ctx)} this month vs about ${money(worst.avg, ctx)} normally — that's the main pull on your cash.`,
          }, chips: [
            { label: `See ${getCat(worst.cat).label}`, prompt: `how much on ${worst.cat} this month` },
            { label: 'Where can I cut back?', prompt: 'where can I cut back' },
          ] };
      }
      return { kind: 'interpret', outcome: 'clear',
        facts: { every_category_this_month: breakdown, spend_by_account: spendByAccount(ctx, mk),
          biggest_rise: 'nothing is well above its usual' },
        analysis: [compared, 'Nothing is running well above its usual'],
        vars: {
          detail: `your spending is tracking close to your normal pattern this month.`,
        }, chips: [
          { label: 'What did I spend most on?', prompt: 'what did I spend the most on this month' },
        ] };
    }
    case 'interpret.budgets': {
      const over = ctx.summary.budgets.filter(b => b.spentPct > 100);
      const near = ctx.summary.budgets.filter(b => b.spentPct > 80 && b.spentPct <= 100);
      const detail = over.length
        ? `${over.length} over: ${over.map(b => getCat(b.category).label).join(', ')}.`
        : near.length
          ? `${near.length} close to the limit: ${near.map(b => getCat(b.category).label).join(', ')}.`
          : ctx.summary.budgets.length ? `all ${ctx.summary.budgets.length} budgets are on track.` : `you have no budgets yet.`;
      // Chips only when there is something to chase — "Budgets look healthy"
      // needs no follow-up, and an offer of one implies a problem there isn't.
      const worstBudget = over[0] ?? near[0];
      const count = ctx.summary.budgets.length;
      // v10.46.0 (#66) — pace: a budget used faster than the month has gone is
      // "ahead of pace" even while under its limit. 60% used with 40% of the month
      // gone is the early warning "close to limit" only gives at 80%.
      const now = new Date();
      const monthGone = (now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) * 100;
      const onPace = ctx.summary.budgets.filter(b => b.spentPct <= monthGone).length;
      return { kind: 'interpret', outcome: 'ok',
        facts: {
          budgets_most_used_first: [...ctx.summary.budgets].sort((a, b) => b.spentPct - a.spentPct).map(b => ({
            category: getCat(b.category).label,
            limit: money(b.limit, ctx),
            used: `${Math.round(b.spentPct)}%`,
            status: b.spentPct > 100 ? 'over budget' : b.spentPct > 80 ? 'close to limit' : 'on track',
            pace: b.spentPct <= monthGone ? 'within pace' : 'ahead of pace',
          })),
          over_budget: over.map(b => getCat(b.category).label),
          close_to_limit: near.map(b => getCat(b.category).label),
          ...(count ? { within_pace: `${onPace} of ${count}`, month_gone: `${Math.round(monthGone)}%` } : {}),
        },
        analysis: [
          `Checked ${count} ${count === 1 ? 'budget' : 'budgets'} against spending`,
          over.length ? `${over.length} over budget` : near.length ? `${near.length} close to the limit` : 'All on track',
        ],
        vars: {
        headline: over.length ? 'Some budgets need attention.' : near.length ? 'A couple of budgets are getting close.' : 'Budgets look healthy.',
        detail,
      }, chips: worstBudget ? [
        { label: `Why is ${getCat(worstBudget.category).label} over?`, prompt: `why is my ${getCat(worstBudget.category).label.toLowerCase()} spending so high` },
        { label: 'Where can I cut back?', prompt: 'where can I cut back' },
      ] : undefined };
    }
    case 'interpret.debts': {
      const d = ctx.summary.debts;
      if (!d.length) return { kind: 'interpret', outcome: 'ok',
        facts: { debts: [], note: 'no debts recorded' }, analysis: ['Checked your debts — none recorded'],
        vars: { headline: "You're debt-free.", detail: 'Nothing to pay down right now.' } };
      // v10.38 (F10) — ONE total. This case used to sum the debts array while
      // `interpret.status` reported the live liabilities from the canonical net-worth
      // projection, so the same session saw ₹25,74,533 and ₹25,73,809.
      const totalDebt = ctx.summary.netWorth.totalLiabilities;
      const top = [...d].sort((a, b) => b.aprPct - a.aprPct)[0];
      const smallest = [...d].sort((a, b) => a.balance - b.balance)[0];
      const debtLabel = (x: { type: string }) => getCat(x.type).label || x.type;
      return { kind: 'interpret', outcome: 'ok',
        facts: {
          total_owed: money(totalDebt, ctx),
          debts_highest_rate_first: debtFacts(ctx),
          avalanche_pays_first: `${debtLabel(top)} (highest interest rate, saves the most interest)`,
          snowball_pays_first: `${debtLabel(smallest)} (smallest balance, quickest to clear)`,
        },
        analysis: [
          `Reviewed ${d.length} ${d.length === 1 ? 'debt' : 'debts'}`,
          'Ranked them by interest rate and by balance',
        ],
        vars: {
          headline: `You owe ${money(totalDebt, ctx)} across ${d.length} debt${d.length === 1 ? '' : 's'}.`,
          detail: `Highest rate: ${getCat(top.type).label || top.type} at ${top.aprPct}% — the avalanche method targets it first.`,
        } };
    }
    case 'interpret.bills': {
      // v10.46.0 — dates compared as local `YYYY-MM-DD` strings, as the ledger
      // stores them. `new Date(nextDueDate)` is UTC midnight, which set against a
      // local midnight dropped or kept a bill due today depending on the time zone.
      // Bills are EXPENSE schedules: a salary is not a bill.
      const now = new Date();
      const today = isoDay(now);
      const weekEnd = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6));
      const monthAgo = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 45));
      const bills = (ctx.recurring ?? [])
        .filter(r => r.active !== false && (r.transactionTemplate.type ?? 'expense') === 'expense')
        .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
      const upcoming = bills.filter(r => r.nextDueDate >= today);
      const thisWeek = upcoming.filter(r => r.nextDueDate <= weekEnd);
      // Waiting on the user: due, not self-posting, not so old it is corrupt data.
      const awaiting = bills.filter(r => r.nextDueDate < today && r.nextDueDate >= monthAgo && !r.autoConfirm);
      const billFact = (r: RecurringSchedule) => ({
        // The category label, NOT `transactionTemplate.description`: the description
        // is user-authored text that SafeSummary excludes from egress.
        category: getCat(r.transactionTemplate.category).label,
        amount: money(r.transactionTemplate.amount, ctx),
        due: r.nextDueDate,
        posts: r.autoConfirm ? 'automatically' : 'after you approve it',
      });
      if (!upcoming.length && !awaiting.length) return { kind: 'interpret', outcome: 'ok',
        facts: { upcoming_soonest_first: [], due_this_week: [] }, analysis: ['Looked for upcoming bills — none tracked'],
        vars: { headline: 'No upcoming bills tracked.', detail: 'Add a recurring schedule to see what is due.' } };
      // A total only when every bill in it is in (or convertible to) the household
      // currency: `convert` treats a missing rate as 1, so a foreign bill with no
      // rate would be added at face value.
      const convertible = thisWeek.every(r => !r.transactionTemplate.currency || r.transactionTemplate.currency === cur(ctx)
        || (hasRate(ctx.rates, r.transactionTemplate.currency) && hasRate(ctx.rates, cur(ctx))));
      const weekTotal = thisWeek.reduce((s, r) =>
        s + convert(r.transactionTemplate.amount, r.transactionTemplate.currency || cur(ctx), cur(ctx), ctx.rates), 0);
      const soon = upcoming.slice(0, 3);
      const detail = soon.map(r => `${r.transactionTemplate.description || getCat(r.transactionTemplate.category).label} (${r.nextDueDate})`).join(', ');
      return { kind: 'interpret', outcome: 'ok',
        facts: {
          due_this_week: thisWeek.map(billFact),
          due_this_week_count: String(thisWeek.length),
          total_due_this_week: !thisWeek.length ? 'nothing due this week'
            : convertible ? money(weekTotal, ctx) : 'not totalled: a bill is in a currency with no exchange rate set',
          upcoming_soonest_first: soon.map(billFact),
          ...(awaiting.length ? { overdue_waiting_for_your_approval: awaiting.map(billFact) } : {}),
        },
        analysis: [
          thisWeek.length ? `Found ${thisWeek.length} ${thisWeek.length === 1 ? 'bill' : 'bills'} due in the next 7 days` : 'Nothing due in the next 7 days',
          ...(awaiting.length ? [`${awaiting.length} past due and waiting for your approval`] : []),
        ],
        vars: { headline: `Next up: ${soon.length} bill${soon.length === 1 ? '' : 's'}.`, detail } };
    }

    // ── Forecast (Planner-grounded) ──────────────────────────────────────────────
    case 'forecast.affordability': {
      // No chip: the reply itself asks "how much?", and a chip that repeats the
      // answer is exactly what the deck's rule forbids.
      if (e.amount == null) return { kind: 'forecast', outcome: 'missing_amount', vars: {},
        facts: { needs: 'the purchase amount' }, analysis: ['Need the purchase amount to check affordability'] };
      // v10.38 — ONE liquidity source (the canonical net-worth projection, which
      // includes live account balances) and ONE spend baseline. The old
      // `liquidAssets(ctx.assets)` read the assets array only, so this seam and
      // `interpret.status` reported 1.2 and 68.6 months of cover for the same money.
      const liquid = ctx.summary.netWorth.liquidAssets;
      const basis = basisOf(ctx);
      const floor = emergencyFloor(ctx);
      // v10.39.1 (P19) — the card bill is paid from this same money, so it comes off
      // before anything is "spare".
      const dues = ctx.summary.netWorth.cardDues;
      const free = liquid - dues;
      const headroom = free - floor;
      // v10.48.1 — WHAT DECIDES THE ANSWER. It used to be the savings floor alone: a
      // household already below its floor was told "₹5 would dip into the safety floor,
      // shortfall ₹44,831" for a cup of tea (production, 27 Sep). Now:
      //   1. the purchase's category budget this month, when it has one ("tea" → Food &
      //      Dining), and
      //   2. whether the money free after card dues covers it.
      // The safety floor is a SOFT constraint: stated separately, as a risk, and never
      // the verdict (owner's rule, 27 Sep).
      const category = purchaseCategory(e);
      const label = category ? getCat(category).label : undefined;
      const mk = nowMonthKey();
      const line = category ? categoryBudget(ctx, category, mk) : undefined;
      const lineLeft = category && line
        ? line.limit - (spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates)[category] || 0)
        : undefined;
      const covered = e.amount <= free;
      const inBudget = lineLeft == null || e.amount <= lineLeft;
      const outcome = !covered ? 'tight' : !inBudget ? 'over_budget' : 'fits';
      const verdict = !covered ? 'more than the money free after card dues'
        : !inBudget ? `over the ${label} budget this month`
        : line ? `fits the ${label} budget this month` : 'fits';
      const floorPosition = headroom < 0 ? 'already below the safety floor, before this purchase'
        : headroom < e.amount ? 'this purchase would take savings below the safety floor'
        : 'savings stay above the safety floor';
      const affordFacts = {
        purchase: money(e.amount, ctx),
        ...(label ? { what_it_is_for: label } : {}),
        ...(line && lineLeft != null ? {
          budget_this_month: money(line.limit, ctx),
          budget_left_this_month: signedMoney(lineLeft, ctx, 'left', 'over'),
          budget_left_after_purchase: signedMoney(lineLeft - e.amount, ctx, 'left', 'over'),
        } : label ? { budget_this_month: `no ${label} budget this month` } : {}),
        liquid_savings: money(liquid, ctx),
        card_dues_to_pay: money(dues, ctx),
        free_to_spend_after_card_dues: signedMoney(free, ctx, 'free', 'short'),
        free_after_purchase: signedMoney(free - e.amount, ctx, 'free', 'short'),
        verdict,
        verdict_rests_on: line ? `the ${label} budget and the money free after card dues` : 'the money free after card dues',
        typical_monthly_spending: money(basis.averageMonthly, ctx),
        typical_essential_monthly: money(basis.averageEssential, ctx),
        typical_discretionary_monthly: money(basis.averageDiscretionary, ctx),
        months_considered: basisLabel(ctx),
        // The soft constraint, for its own paragraph (PHRASE_SYSTEM).
        safety_floor: money(floor, ctx),
        safety_floor_basis: `three months of your typical essential spending, averaged over ${basisLabel(ctx)}`,
        // Signed: this crosses zero, and `money()` would print a deficit as a surplus.
        headroom_against_floor: signedMoney(headroom, ctx),
        safety_floor_note: floorPosition,
        safety_floor_is: 'a risk to know about, not the verdict',
      };
      const affordAnalysis = [
        ...(line ? [`Checked what is left in your ${label} budget this month`] : []),
        'Totalled your liquid savings',
        ...(dues > 0 ? ['Set aside what your credit cards owe'] : []),
        'Compared the purchase with the money free after card dues',
        `Noted where your savings stand against a three-month safety floor (averaged over ${basisLabel(ctx)})`,
      ];
      if (outcome === 'fits') {
        const aboveFloorAfter = headroom - e.amount;
        return { kind: 'forecast', outcome: 'fits',
          facts: { ...affordFacts, ...(aboveFloorAfter >= 0 ? { left_above_floor_after: money(aboveFloorAfter, ctx) } : {}) },
          // v10.47.0 — the WhatsApp card says "…would still leave about ₹X above your safety
          // floor", so its figures go out only when that sentence is true.
          ...(aboveFloorAfter >= 0 ? { amounts: {
            purchase: Math.round(e.amount), cushion: Math.round(aboveFloorAfter), floor: Math.round(floor),
            free_to_spend: Math.round(free),
          } } : {}),
          analysis: affordAnalysis,
          vars: { amount: money(e.amount, ctx), headroom: money(headroom, ctx), cushion: money(aboveFloorAfter, ctx) },
          chips: [{ label: 'How long would my savings last?', prompt: 'how long would my savings last' }] };
      }
      if (outcome === 'over_budget') {
        return { kind: 'forecast', outcome: 'over_budget',
          facts: { ...affordFacts, over_budget_by: money(e.amount - (lineLeft ?? 0), ctx) },
          analysis: affordAnalysis,
          vars: { amount: money(e.amount, ctx), category: label ?? '' },
          chips: [
            { label: 'Where can I cut back?', prompt: 'where can I cut back' },
            { label: `How much on ${label} this month?`, prompt: `how much on ${(label ?? '').toLowerCase()} this month` },
          ] };
      }
      // More than the money free after card dues. Not a flat "no": the chips are the way forward.
      return { kind: 'forecast', outcome: 'tight',
        facts: { ...affordFacts, shortfall: money(e.amount - Math.max(0, free), ctx) },
        analysis: affordAnalysis,
        vars: { amount: money(e.amount, ctx), shortfall: money(e.amount - Math.max(0, free), ctx) },
        chips: [
          { label: 'Where can I cut back?', prompt: 'where can I cut back' },
          { label: 'How long would my savings last?', prompt: 'how long would my savings last' },
        ] };
    }
    case 'forecast.runway': {
      // Same single source as affordability and status (v10.38).
      const liquid = ctx.summary.netWorth.liquidAssets;
      const basis = basisOf(ctx);
      const burn = basis.averageMonthly || (totalMonthlyDebtPayment(ctx.debts, cur(ctx), ctx.rates) + 1);
      const months = burn > 0 ? liquid / burn : 0;
      return { kind: 'forecast', outcome: 'ok',
        facts: {
          months_money_would_last: months.toFixed(1),
          liquid_savings: money(liquid, ctx),
          typical_monthly_spending: money(burn, ctx),
          typical_essential_monthly: money(basis.averageEssential, ctx),
          typical_discretionary_monthly: money(basis.averageDiscretionary, ctx),
          months_considered: basisLabel(ctx),
          largest_categories_this_month: categoryBreakdown(ctx).slice(0, 5),
        },
        analysis: [
          'Totalled your liquid savings',
          `Averaged your spending over ${basisLabel(ctx)}`,
          'Measured how many months the savings would cover',
        ],
        vars: { months: months.toFixed(1) }, chips: [
        { label: 'Where can I cut back?', prompt: 'where can I cut back' },
        { label: 'What is driving my spending?', prompt: 'where is my money going' },
      ] };
    }
    case 'forecast.prescriptive': {
      const target = e.amount;
      const mk = nowMonthKey();
      const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
      // Rank "want" categories by overage vs rolling average — least-painful trims.
      let best: { cat: string; over: number } | null = null;
      // Whether `best.over` is an amount ABOVE usual, or (fallback) the category's
      // whole spend because there is no history yet. The model must not describe a
      // total as an overage, so the facts say which one it is.
      let basis: 'above_usual' | 'total_spent' = 'above_usual';
      for (const [c, amt] of Object.entries(spend)) {
        if (NEEDS_WANTS_MAP[c] !== 'want') continue;
        const over = amt - categoryRollingAvg(ctx, c);
        if (over > 0 && (!best || over > best.over)) best = { cat: c, over };
      }
      if (!best) {
        // fall back to the single biggest discretionary category
        const top = Object.entries(spend).filter(([c]) => NEEDS_WANTS_MAP[c] === 'want')
          .sort(([, a], [, b]) => b - a)[0];
        if (top) { best = { cat: top[0], over: top[1] }; basis = 'total_spent'; }
      }
      const breakdown = categoryBreakdown(ctx);
      // v10.38 (F4) — advice sees the POSITION, not just this month's categories.
      // Without it, "what should I do?" could only suggest trimming the largest
      // discretionary line — ₹54 for a household with a 95% savings rate and a
      // mortgage at 8.75%. The biggest lever is rarely a category.
      const prescriptiveFacts = {
        savings_goal: target ? money(target, ctx) : 'not specified',
        ...positionFacts(ctx),
        debts_highest_rate_first: debtFacts(ctx),
        // v10.39 (P4) — "what should I sell?" needs to see WHAT is owned, and how
        // quickly each part could be reached. The answer still must not recommend
        // selling a specific holding (PHRASE_SYSTEM), but it can now name what
        // exists rather than declining for want of a list.
        what_you_own: assetsByLiquidity(ctx),
        discretionary_categories: breakdown.filter(r => r.kind === 'discretionary'),
        essential_categories: breakdown.filter(r => r.kind === 'essential'),
      };
      const compared = `Compared ${breakdown.length} ${breakdown.length === 1 ? 'category' : 'categories'} with your usual month`;
      const positionRead = 'Read your income, savings rate, cushion and debts';
      if (!best) return { kind: 'forecast', outcome: 'ok', vars: { months: '0' },
        facts: { ...prescriptiveFacts, note: 'no discretionary spending recorded this month' },
        analysis: [positionRead, compared, 'No discretionary spending found to trim'] };
      return { kind: 'forecast', outcome: 'suggest',
        facts: {
          ...prescriptiveFacts,
          easiest_trim: getCat(best.cat).label,
          easiest_trim_figure: money(best.over, ctx),
          easiest_trim_figure_means: basis === 'above_usual'
            ? 'how much this category is above its usual month'
            : 'total spent in this category this month (no history yet to compare)',
        },
        analysis: [
          positionRead,
          compared,
          'Separated discretionary spending from essentials',
          `${getCat(best.cat).label} is the easiest place to trim`,
        ],
        vars: {
          target: target ? money(target, ctx) : 'some room',
          category: getCat(best.cat).label.toLowerCase(),
          over: money(best.over, ctx),
        } };
    }

    default:
      return fallback();
  }
}

function fallback(): ResolveResult {
  // v10.38 — a question we cannot place now arrives at the model WITH the
  // capability list, so the reply names the nearest thing that does work instead of
  // being a dead end. Validation produced a run of these ("plan October for the
  // festival season", "how much over the last 60 days") and every one deserved a
  // useful redirect rather than a shrug.
  return {
    kind: 'fallback', outcome: 'default',
    facts: { ...CAPABILITIES },
    analysis: ['Could not match this to something I can compute'],
    vars: {},
  };
}

/**
 * What Ask Vyact can and cannot answer, in the assistant's own words (v10.38).
 *
 * Handed to the model for `meta.assistant` and for any question whose data the app
 * does not hold, so "I can't do that" arrives WITH the nearest thing that works
 * instead of as a dead end. Kept beside `resolve()` because it must change whenever
 * the intent set does — a capability list that drifts is worse than none.
 */
export const CAPABILITIES = {
  can_answer: [
    'spending for this month or a named past month, by category or in total',
    'why spending moved, and which categories are above their usual',
    'your overall position: net worth, assets, debt, liquid cover, savings rate',
    'which accounts hold your money, and which account or card a spend came from',
    'what you own and how quickly each part could be reached',
    'budget status, and which budgets are over their limit',
    'debts with balances and interest rates, and which to clear first',
    // v10.39.1 (P22) — was "upcoming and recurring bills", which read as if the
    // assistant could manage them. It lists the ones already set up; it does not
    // pay or change them.
    'listing upcoming bills you have set up as recurring schedules',
    'how much is free to spend once your credit card dues are paid',
    'whether a purchase fits above your safety floor, in your currency or another',
    'how long your savings would last without income',
    'where you could cut back',
    'recording an expense, income, transfer, investment or split (you confirm the form)',
    'setting up a recurring bill, subscription or salary (you choose the account and save)',
  ],
  cannot_answer_yet: [
    'paying, sending or moving real money, or contacting anyone — I read your records and pre-fill forms only',
    'which specific holding to sell — that needs tax, lock-ins and what each is for',
    'windows other than whole months (last 60 days, since payday, daily pace)',
    'simulations: what an extra payment does to a payoff date, or to a net worth milestone',
    'who in the household logged or paid something, and how a shared split is balanced',
    'what changed over a period and why (net worth attribution)',
    'whether allocations cover a future dated commitment such as an annual premium',
    'anything about a future month: seasonal or festival planning',
  ],
} as const;

// ── LlmBackend — the ONLY assistant backend (v10.20) ────────────────────────────
//
// The deterministic `RulesBackend` was REMOVED in v10.20 by product decision:
// Ask Vyact is model-backed, with no rules fallback for classify/phrase.
//
// What did NOT move: stage 4, `resolve()` above. Every figure the assistant says
// still comes from it. The model decides WHICH question this is and says the
// answer in words — it never computes money. That is the binding rule, and
// `assertNoInventedFigures` enforces it on the way out rather than trusting the
// prompt to have been obeyed.
//
// CONSEQUENCE, stated plainly: with no model configured and reachable, Ask Vyact
// cannot answer. `runAssistant` surfaces that as an explicit unavailable turn —
// it must never silently degrade to a canned reply, because a finance assistant
// that quietly stops thinking while still sounding confident is worse than one
// that says it is unavailable.
export class LlmBackend implements AssistantBackend {
  readonly id = 'llm' as const;
  constructor(private readonly call: ModelCall) {}

  async classifyIntent(utterance: string, ctx: AssistantContext): Promise<IntentResult> {
    return classifyIntentViaModel(utterance, ctx, this.call);
  }

  /** `seed` is accepted for interface conformance; a model does not use a
   *  variant table, so phrasing variety comes from the model itself. */
  async phraseResponse(
    intent: IntentResult, result: ResolveResult, ctx?: AssistantContext, _seed?: number,
    prevAllowed: readonly string[] = [],
  ): Promise<string> {
    return phraseViaModel(intent, result, this.call, prevAllowed, ctx?.channel ?? 'app');
  }
}

/**
 * The model transport. Resolved per turn (never memoised at module scope) so a
 * DB-driven configuration change takes effect on the next question rather than
 * requiring a page reload.
 *
 * Returns null when no model is configured — the caller must treat that as
 * "unavailable", not as a reason to invent an answer.
 */
export function selectModelCall(): ModelCall | null {
  return resolveConfiguredModelCall();
}

/** The active backend, or null when no model is reachable. */
export function selectAssistantBackend(): AssistantBackend | null {
  const call = selectModelCall();
  return call ? new LlmBackend(call) : null;
}

// ── The orchestrator — runs all five stages ─────────────────────────────────────
// The `backend` default is evaluated PER CALL (not captured at module load), so a
// runtime change to `FEATURES.askVyact.backend` takes effect on the next turn.
/** Plain-English name for each intent, shown as the "Recognised: …" step. */
const INTENT_LABEL: Record<string, string> = {
  'capture.expense': 'recording an expense',
  'capture.income': 'recording income',
  'capture.transfer': 'recording a transfer',
  'capture.investment': 'recording an investment',
  'capture.split': 'splitting a bill',
  'interpret.lookup': 'looking up your spending',
  'interpret.status': 'reviewing your overall position',
  'interpret.diagnostic': "working out what's driving your spending",
  'interpret.budgets': 'checking your budgets',
  'interpret.debts': 'reviewing your debts',
  'interpret.bills': 'finding your upcoming bills',
  'forecast.affordability': 'checking whether you can afford it',
  'forecast.runway': 'working out how long your money lasts',
  'forecast.prescriptive': 'finding where you could save',
  'meta.assistant': 'answering about me, not your money',
  'capture.recurring': 'setting up a recurring bill',
  'unsupported': "something I can't do from here",
};

export async function runAssistant(
  utterance: string,
  ctx: AssistantContext,
  backend: AssistantBackend | null = selectAssistantBackend(),
  seed = Date.now(),
  /**
   * v10.36 — receives each analysis step as it ACTUALLY happens, so the chat can
   * print real progress while the model works. Each step maps to a real stage;
   * none is a timed placeholder. Optional: every existing caller and test passes
   * four arguments and is unaffected.
   */
  onProgress?: (step: string) => void,
  /**
   * v10.38 — figures the PREVIOUS assistant turn was allowed to use. Passed to the
   * guard so a follow-up may cite the number it is challenging; the guard is
   * otherwise per-turn, and discarded exactly that kind of correction.
   */
  prevAllowed: readonly string[] = [],
): Promise<AssistantTurn> {
  // No model configured or reachable. Say so — never fake an answer. There is no
  // rules fallback by design (v10.20), and a finance assistant that invents a
  // reply when it cannot think is worse than one that admits it is offline.
  //
  // v10.39.1 (P17) — except for a greeting or a question about the assistant, which
  // has no household answer to fake: those are answered here, before any model.
  const quick = quickReply(utterance, ctx);
  if (quick) {
    return {
      reply: quick.reply, bucket: 'none', intentId: 'meta.assistant',
      chips: normaliseChips(quick.chips), clarify: false, allowedFigures: [],
    };
  }
  if (!backend) return unavailableTurn('not_configured');

  onProgress?.('Understanding your question');
  let intent: IntentResult;
  try {
    intent = await backend.classifyIntent(utterance, ctx);         // stages 1–3
  } catch (err) {
    if (err instanceof ModelUnavailableError) return unavailableTurn('unreachable');
    throw err;
  }

  // Per-bucket gate: a disabled bucket degrades to a clarifying fallback (§2).
  const gated = intent.bucket !== 'none' && !isAskVyactBucketEnabled(intent.bucket);
  const effective: IntentResult = gated
    ? { ...intent, id: 'fallback', bucket: 'none' }
    : intent;
  if (INTENT_LABEL[effective.id]) onProgress?.(`Recognised: ${INTENT_LABEL[effective.id]}`);
  const result = gated ? fallback() : resolve(effective, ctx);     // stage 4 (never LLM)
  for (const step of result.analysis ?? []) onProgress?.(step);

  // v10.38 (F7) — a seeded capture is acknowledged DETERMINISTICALLY, with no model
  // call at all.
  //
  // Capture handed the model `facts: {}` — there was nothing to phrase — and the
  // chat navigated to the pre-filled form as soon as the turn resolved, so the
  // sentence the model was writing arrived after the form had replaced the chat, or
  // (when the guard rejected a date or the user's own amount) never arrived at all.
  // One less call, half the latency, and the acknowledgement always exists.
  if (result.kind === 'capture' && result.outcome === 'seeded') {
    return {
      reply: captureAcknowledgement(result),
      bucket: effective.bucket,
      intentId: effective.id,
      seed: result.seed,
      chips: normaliseChips(result.chips),
      clarify: false,
      allowedFigures: figuresAllowedBy(result),
    };
  }
  // v10.39.1 (P21) — same rule for a recurring draft: acknowledged here, then the
  // Recurring sheet opens with it.
  if (result.kind === 'capture' && result.outcome === 'recurring_seeded') {
    return {
      reply: recurringAcknowledgement(result),
      bucket: effective.bucket,
      intentId: effective.id,
      recurringSeed: result.recurringSeed,
      clarify: false,
      allowedFigures: figuresAllowedBy(result),
    };
  }
  // v10.39.1 (P17) — about the assistant: no household data, no phrase call.
  if (effective.id === 'meta.assistant') {
    return {
      reply: aboutMeReply(utterance), bucket: 'none', intentId: effective.id,
      chips: normaliseChips(QUICK_CHIPS), clarify: false, allowedFigures: [],
    };
  }

  onProgress?.('Writing your answer');
  let reply: string;
  try {
    reply = await backend.phraseResponse(effective, result, ctx, seed, prevAllowed);
  } catch (err) {
    if (err instanceof ModelUnavailableError) return unavailableTurn('unreachable');
    // The model put a figure in the reply that no tool computed. Discard the
    // whole reply: showing an invented number in a finance app is the one
    // failure this system exists to prevent.
    if (err instanceof InventedFigureError) return unavailableTurn('unverified_figures');
    throw err;
  }

  return {
    reply,
    bucket: effective.bucket,
    intentId: effective.id,
    seed: result.seed,
    // The ONE place the cap and the well-formedness rule are applied, so every
    // channel gets the same list and no call site can opt out of the limit.
    chips: normaliseChips(result.chips),
    clarify: gated || result.kind === 'fallback' || result.outcome === 'missing_amount'
      || result.outcome === 'needs_rate',
    allowedFigures: figuresAllowedBy(result),
    // v10.47.0 — what resolve() decided, for a channel that renders a fixed card.
    resolved: { outcome: result.outcome, ...(result.amounts ? { amounts: result.amounts } : {}) },
  };
}

/** Reason codes are distinct so telemetry can tell "never set up" from
 *  "set up but broken" from "the model misbehaved" — three different fixes. */
export type UnavailableReason = 'not_configured' | 'unreachable' | 'unverified_figures';

const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  not_configured: "Pip isn't set up yet.",
  unreachable: "I can't reach the assistant right now. Your data is untouched — please try again shortly.",
  unverified_figures: "I couldn't verify the numbers in that answer, so I haven't shown it. Please ask again.",
};

function unavailableTurn(reason: UnavailableReason): AssistantTurn {
  return {
    reply: UNAVAILABLE_COPY[reason],
    bucket: 'none',
    intentId: 'unavailable',
    clarify: true,
  };
}

// ── Proactive "what to know" (spec §5, gated by proactiveInsight) ───────────────
export interface ProactiveInsight { text: string; chipPrompt?: string; }

/** At most ONE insight, ranked by materiality. Positive observations count too.
 *  Pure read over the summary + entities; caller rate-limits to one per session. */
export function proactiveInsight(ctx: AssistantContext): ProactiveInsight | null {
  if (!FEATURES.askVyact.proactiveInsight || !isAskVyactBucketEnabled('interpret')) return null;
  const s = ctx.summary;

  // 1) A budget meaningfully over — highest materiality.
  const over = s.budgets.filter(b => b.spentPct > 100).sort((a, b) => b.spentPct - a.spentPct)[0];
  if (over) {
    return {
      text: `Your ${getCat(over.category).label.toLowerCase()} is ${Math.round(over.spentPct)}% of budget — want to see why?`,
      chipPrompt: `why is my ${over.category} so high`,
    };
  }
  // 2) A category running hot vs its norm.
  const mk = nowMonthKey();
  const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
  let hot: { cat: string; pct: number } | null = null;
  for (const [c, amt] of Object.entries(spend)) {
    const avg = categoryRollingAvg(ctx, c);
    if (avg > 0) {
      const pct = Math.round(((amt - avg) / avg) * 100);
      if (pct >= 30 && (!hot || pct > hot.pct)) hot = { cat: c, pct };
    }
  }
  if (hot) {
    return {
      text: `Your ${getCat(hot.cat).label.toLowerCase()} is ${hot.pct}% above your usual — want to see why?`,
      chipPrompt: `where is my money going`,
    };
  }
  // 3) Positive: beating the savings target.
  if (s.thisMonth.netSavingsRate >= 0.2) {
    // v10.46.0 — the response contract: state it, no praise (was "— nicely done.").
    return { text: `You're on track to save ${Math.round(s.thisMonth.netSavingsRate * 100)}% of your income this month.` };
  }
  return null;
}
