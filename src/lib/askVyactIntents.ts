// Vyact v7.4.5 — Ask Vyact intent taxonomy
//
// Two-tap quick actions for the Chat surface. Each intent is a single tap-1
// chip the user can pick from the empty-state grid. If the intent has
// `secondary` chips it expands a tap-2 row that finalises the action; if
// not, the primary action fires immediately on tap-1.
//
// The four buckets map to the user's mental model:
//   • Capture  — record something that happened (Add ...)
//   • Inquire  — ask about current state (How much / what is ...)
//   • Plan     — decide / project (can-I-afford, what-if)
//   • Manage   — open / configure
//
// Actions are a typed union so the Chat page can dispatch deterministically:
//   - `open-modal` opens a global modal (optionally pre-seeded)
//   - `navigate`   pushes a route
//   - `ask`        falls through to the rule engine in askVyactBrain.ts,
//                  which itself can fall back to Gemini if a key is set.

import type { Transaction, TxnType } from '../types';

// v10.17 (item 16) — the 'manage' bucket (Open Budgets/Net Worth/Households)
// was removed: those chips fired `navigate()` under the open Ask drawer and
// read as dead. Deep navigation lives in the app's own nav.
export type Bucket = 'capture' | 'inquire' | 'plan';

export type IntentAction =
  | { kind: 'open-modal'; modal: 'addTxn' | 'addBudget' | 'addDebt' | 'addAsset'; seed?: Partial<Transaction> }
  | { kind: 'navigate'; to: string }
  | { kind: 'ask'; prompt: string };

export interface SubChip {
  label: string;
  action: IntentAction;
}

export interface Intent {
  id: string;
  bucket: Bucket;
  label: string;
  /** Board D M6 — the glyph shown in the intent row's inset icon tile. */
  icon: string;
  example?: string;
  inputHint?: string;
  /** When set, tapping the chip primes a sub-row of secondary chips. */
  secondary?: SubChip[];
  /** When `secondary` is absent, the chip fires this action on tap-1. */
  action?: IntentAction;
}

export const INTENTS: Intent[] = [
  // ── Capture ─────────────────────────────────────────────────
  { id: 'add-expense',     bucket: 'capture', icon: '➕', label: 'Add expense', example: 'Spent 45 on groceries today', action: { kind: 'open-modal', modal: 'addTxn', seed: { type: 'expense' } } },
  { id: 'add-income',      bucket: 'capture', icon: '💰', label: 'Add income', example: 'Received 5000 salary today', action: { kind: 'open-modal', modal: 'addTxn', seed: { type: 'income' } } },
  { id: 'add-transfer',    bucket: 'capture', icon: '🔄', label: 'Add transfer', example: 'Transferred 200 from my bank to cash', action: { kind: 'open-modal', modal: 'addTxn', seed: { type: 'transfer' as TxnType, category: '' } } },
  { id: 'add-investment',  bucket: 'capture', icon: '📈', label: 'Add investment', example: 'Invested 500 in my index fund', inputHint: 'Choose the investment asset and paying account in the form.', action: { kind: 'open-modal', modal: 'addTxn', seed: { type: 'investment' as TxnType, category: '' } } },
  { id: 'add-budget',      bucket: 'capture', icon: '🎯', label: 'Add a budget', inputHint: 'Form example: monthly limit 3000, groceries 400. Budget creation is not a chat command.', action: { kind: 'open-modal', modal: 'addBudget' } },
  { id: 'add-debt',        bucket: 'capture', icon: '⬇️', label: 'Add a debt', inputHint: 'Form example: Car loan, balance 6000, APR 6%, payment 250. Debt creation is not a chat command.', action: { kind: 'open-modal', modal: 'addDebt' } },
  { id: 'add-asset',       bucket: 'capture', icon: '🏠', label: 'Add an asset', inputHint: 'Form example: Investment, Index fund, value 3000. Asset creation is not a chat command.', action: { kind: 'open-modal', modal: 'addAsset' } },

  // ── Inquire ─────────────────────────────────────────────────
  { id: 'spend-month',     bucket: 'inquire', icon: '💸', label: 'Spend this month', action: { kind: 'ask', prompt: 'How much did I spend this month?' } },
  { id: 'health',          bucket: 'inquire', icon: '💚', label: 'Household overview', action: { kind: 'ask', prompt: 'How am I doing financially?' } },
  { id: 'net-worth',       bucket: 'inquire', icon: '⚖️', label: 'Net worth',        action: { kind: 'ask', prompt: "What's my net worth?" } },
  { id: 'budgets-risk',    bucket: 'inquire', icon: '⚠️', label: 'Budgets at risk',  action: { kind: 'ask', prompt: 'Which budgets are at risk?' } },
  { id: 'top-categories',  bucket: 'inquire', icon: '📊', label: 'Top categories',   action: { kind: 'ask', prompt: 'What are my top spending categories this month?' } },
  { id: 'upcoming-bills',  bucket: 'inquire', icon: '🔁', label: 'Upcoming bills',   action: { kind: 'ask', prompt: 'What are my upcoming bills?' } },

  // ── Plan ────────────────────────────────────────────────────
  { id: 'emergency',       bucket: 'plan',    icon: '🛡️', label: 'Income interruption', action: { kind: 'ask', prompt: 'How long would my money last without income?' } },
  { id: 'debts',           bucket: 'plan',    icon: '⬇️', label: 'Debt strategy',    action: { kind: 'ask', prompt: 'Tell me about my debts and the best payoff strategy.' } },
  { id: 'affordability', bucket: 'plan', icon: '🛒', label: 'Can I afford it?', action: { kind: 'ask', prompt: 'Can I afford a 1200 purchase?' } },
  { id: 'cut-back', bucket: 'plan', icon: '✂️', label: 'Find room to save', action: { kind: 'ask', prompt: 'Where can I cut back on spending?' } },
];

export const BUCKET_LABEL: Record<Bucket, string> = {
  capture: 'Record money',
  inquire: 'Understand my money',
  plan:    'Explore a decision',
};

export function intentExample(intent: Intent): string | undefined {
  return intent.action?.kind === 'ask' ? intent.action.prompt : intent.example;
}

export function intentsByBucket(bucket: Bucket): Intent[] {
  return INTENTS.filter(i => i.bucket === bucket);
}

// ─────────────────────────────────────────────────────────────────────────────
// v8.1 — Ask Vyact free-text intent taxonomy (engineering spec §3 stage 3).
//
// This is the rules implementation of `classifyIntent` — the FIRST of the two
// seams a future LlmBackend swaps in (§3). It is a pure function over the parsed
// entities + normalised text; it never computes money. Rule ORDER matters:
//   • income is tested before expense (the "got paid salary" vs "spent" collision)
//   • forecast goal vs runway: "save <amount>" → goal, "last / quit" → runway
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtractedEntities } from './askVyactParser';

export type AssistantBucket = 'capture' | 'interpret' | 'forecast';

export type AssistantIntentId =
  | 'capture.income' | 'capture.split' | 'capture.transfer' | 'capture.expense'
  | 'capture.investment'
  | 'interpret.status' | 'interpret.diagnostic' | 'interpret.lookup'
  | 'interpret.budgets' | 'interpret.bills' | 'interpret.debts'
  | 'forecast.affordability' | 'forecast.runway' | 'forecast.prescriptive'
  | 'fallback';

export interface IntentResult {
  id: AssistantIntentId;
  bucket: AssistantBucket | 'none';
  /** 0–1 rough match strength, for telemetry + future LLM tie-breaks. */
  confidence: number;
  entities: ExtractedEntities;
}

const BUCKET_OF: Record<AssistantIntentId, AssistantBucket | 'none'> = {
  'capture.income': 'capture', 'capture.split': 'capture',
  'capture.transfer': 'capture', 'capture.expense': 'capture',
  'capture.investment': 'capture',
  'interpret.status': 'interpret', 'interpret.diagnostic': 'interpret', 'interpret.lookup': 'interpret',
  'interpret.budgets': 'interpret', 'interpret.bills': 'interpret', 'interpret.debts': 'interpret',
  'forecast.affordability': 'forecast', 'forecast.runway': 'forecast',
  'forecast.prescriptive': 'forecast',
  fallback: 'none',
};

interface IntentRule {
  id: AssistantIntentId;
  /** Tested in array order; first match wins. */
  test: (e: ExtractedEntities) => boolean;
  confidence?: number;
}

// Ordered rules — earlier entries win. Forecast & Interpret are tested before
// Capture so a question ("how much…", "can I afford…") never seeds a transaction.
const RULES: IntentRule[] = [
  // ── Forecast (questions about the future) ───────────────────────────────────
  { id: 'forecast.affordability', test: e => /\b(can i afford|afford|can i buy|should i buy|enough for)\b/.test(e.text) },
  { id: 'forecast.runway',        test: e => /\b(if i (quit|lose|stop)|how (long|many months)|runway|last me|stretch|without (income|a job))\b/.test(e.text) },
  { id: 'forecast.prescriptive',  test: e => /\b(where (can|do) i cut|how (can|do) i save|need .* by|free up|trim|cut back|find \d)\b/.test(e.text) },

  // ── Interpret (questions about current/past state) ──────────────────────────
  { id: 'interpret.budgets',    test: e => /\b(budgets?\b.*\b(risk|over|left|track|exceed)|which budgets|over budget|budget status)\b/.test(e.text) },
  { id: 'interpret.bills',      test: e => /\b(upcoming bills?|bills? due|what bills|recurring|subscriptions?)\b/.test(e.text) },
  { id: 'interpret.debts',      test: e => /\b(my debts?|payoff|pay off|avalanche|snowball|debt strategy|loans?|owe)\b/.test(e.text) },
  { id: 'interpret.status',     test: e => /\b(pulse score|net worth|networth|my balance|how am i doing|am i ok|financial health)\b/.test(e.text) },
  { id: 'interpret.diagnostic', test: e => /\b(why|where('?s| is| are)|what'?s eating|double[- ]?pay|paying twice|forgotten|leak|going wrong)\b/.test(e.text) },
  { id: 'interpret.lookup',     test: e => /\b(how much|how many|show me|what did i|total|biggest|most|top|breakdown|list|spend|spending|categor)\b/.test(e.text) },

  // ── Capture (statements about something that happened) ──────────────────────
  // Capture matches on verb/category even WITHOUT an amount — a missing amount
  // is handled in resolve with a single clarifying chip ("how much?"), per §4.4,
  // not by failing to classify. Interpret/Forecast are tested first (above), so a
  // genuine question never falls through to Capture. Income before expense (§4).
  { id: 'capture.income',   test: e => /\b(got paid|received|salary|paycheck|payday|income|invoice|client paid|refund|earned)\b/.test(e.text) },
  { id: 'capture.split',    test: e => /\b(split|between|ways?|each of us|of us)\b/.test(e.text) },
  // v9 §8 — "put 10k in SIP" → investment contribution (tested before transfer
  // so investment verbs don't fall through to a plain account move).
  { id: 'capture.investment', test: e => /\b(sip|invested|invest|mutual fund|stocks?|brokerage|etf|put .* (in|into) (my )?(sip|fund|stocks?|investment))\b/.test(e.text) },
  { id: 'capture.transfer', test: e => /\b(moved|transfer|transferred|move)\b/.test(e.text) },
  // expense: a spend verb OR a known category (with an amount when only a category).
  { id: 'capture.expense',  test: e => /\b(spent|spend|bought|paid|cost)\b/.test(e.text) || (e.category != null && e.amount != null) },
];

/**
 * Stage 3 — classify a parsed utterance into an assistant intent. Pure; no money.
 * Returns `fallback` when nothing matches so the caller can offer a clarifying
 * chip rather than erroring.
 */
export function classifyIntent(entities: ExtractedEntities): IntentResult {
  for (const rule of RULES) {
    if (rule.test(entities)) {
      return { id: rule.id, bucket: BUCKET_OF[rule.id], confidence: rule.confidence ?? 0.9, entities };
    }
  }
  // Bare "netflix 199" with a category but no verb still reads as an expense.
  if (entities.amount != null && entities.category != null) {
    return { id: 'capture.expense', bucket: 'capture', confidence: 0.6, entities };
  }
  return { id: 'fallback', bucket: 'none', confidence: 0, entities };
}
