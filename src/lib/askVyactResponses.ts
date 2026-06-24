// Vyact — Ask Vyact response/tone layer (engineering spec §7, stage 5).
//
// This is the SECOND of the two seams a future LlmBackend swaps in (the
// `phraseResponse` interface, §3). Tone lives here and ONLY here — tuning the
// voice never touches extraction (stages 1–2) or computation (stage 4).
//
// Rules baked in (§7): answer-first, specific, open-ended (always a next step),
// warm-not-chummy, honest about estimates. Every intent+outcome has ≥3 phrasing
// variants so the assistant never repeats itself verbatim.

import type { IntentResult } from './askVyactIntents';
import type { Transaction } from '../types';

/** The deterministic outcome of stage 4 (`resolve`). Carries pre-formatted
 *  interpolation values and a variant key — NEVER raw template-computed money
 *  (every figure in `vars` came from a Vyact service). */
export interface ResolveResult {
  kind: 'capture' | 'interpret' | 'forecast' | 'fallback';
  /** Variant selector, e.g. 'fits' | 'tight' | 'no' | 'missing_amount' | 'ok'. */
  outcome: string;
  /** Pre-formatted strings for `{token}` interpolation in the variant. */
  vars: Record<string, string | number>;
  /** A one-tap next step shown under the reply (open-ended rule). */
  chip?: { label: string; prompt?: string };
  /** Capture only — the seed for the existing TransactionFormModal. */
  seed?: Partial<Transaction>;
  /** True when any figure leans on onboarding estimates (provenance, §5). */
  usesEstimate?: boolean;
}

type VariantKey = string; // `${intentId}.${outcome}`

// ── Variant arrays — keyed by `${intentId}.${outcome}` ──────────────────────────
// {tokens} interpolate from ResolveResult.vars. Keep them answer-first.
const VARIANTS: Record<VariantKey, string[]> = {
  // ── Capture ───────────────────────────────────────────────────────────────
  'capture.expense.seeded': [
    "Got it — {amount} on {category}. Just confirm and it is logged.",
    "Logged a {amount} {category} expense for you — tap confirm to save.",
    "{amount} on {category}, ready to go. Check it and hit confirm.",
  ],
  'capture.income.seeded': [
    "Nice — {amount} coming in. Confirm and it's in.",
    "Logged {amount} of income — give it a quick check and confirm.",
    "{amount} income ready. Confirm to save it.",
  ],
  'capture.transfer.seeded': [
    "Set up a {amount} transfer — confirm to record it.",
    "Moving {amount} — tap confirm and it's done.",
    "{amount} transfer ready to log. Confirm when it looks right.",
  ],
  'capture.investment.seeded': [
    "Nice — {amount} into your investments. Pick the account and confirm.",
    "{amount} investment contribution ready — confirm to record it.",
    "Logging {amount} toward your investments — check the account and confirm.",
  ],
  'capture.split.seeded': [
    "Split {amount} {ways} ways — your share is {share}. Confirm to log it.",
    "Got it: {amount} across {ways}, you owe {share}. Check and confirm.",
    "{amount} split {ways} ways → {share} each. Confirm to save your part.",
  ],
  'capture.missing_amount': [
    "Got it — how much was it?",
    "Sure — what did that come to?",
    "Happy to log that. How much?",
  ],

  // ── Interpret ───────────────────────────────────────────────────────────────
  'interpret.lookup.ok': [
    "You've spent {amount} on {category} this month.",
    "{category} is at {amount} so far this month.",
    "So far this month: {amount} on {category}.",
  ],
  'interpret.lookup.vs_budget': [
    "{amount} on {category} this month — that's {pct} of your {budget} budget.",
    "Your {category} is {amount}, {pct} of the {budget} you set.",
    "{category}: {amount} spent, {pct} of budget ({budget}).",
  ],
  'interpret.status.ok': [
    "{headline} {detail}",
    "{headline} — {detail}",
    "Here's the read: {headline} {detail}",
  ],
  'interpret.budgets.ok': [
    "{headline} {detail}",
    "{headline} — {detail}",
    "Budgets: {detail}",
  ],
  'interpret.debts.ok': [
    "{headline} {detail}",
    "{headline} — {detail}",
    "Debts: {headline} {detail}",
  ],
  'interpret.bills.ok': [
    "{headline} {detail}",
    "{headline} — {detail}",
    "Upcoming: {detail}",
  ],
  'interpret.diagnostic.found': [
    "{headline} {detail}",
    "Looks like {headline} {detail}",
    "Here's what stands out: {headline} {detail}",
  ],
  'interpret.diagnostic.clear': [
    "Nothing jumping out — {detail}",
    "Looks healthy: {detail}",
    "No red flags right now. {detail}",
  ],

  // ── Forecast ──────────────────────────────────────────────────────────────
  'forecast.affordability.fits': [
    "Yes — after your bills you'd have about {headroom} above your emergency fund, so {amount} fits with {cushion} to spare.",
    "You can swing it — {amount} leaves roughly {cushion} cushion once fixed costs are out.",
    "That works. {amount} fits and still keeps about {cushion} above your safety net.",
  ],
  'forecast.affordability.tight': [
    "It'd be tight — {amount} would dip about {shortfall} into your emergency fund. Wait till payday and it's comfortable.",
    "Doable but snug: you'd eat into your cushion by ~{shortfall}. A week's patience makes it easy.",
    "I'd hold off — {amount} now dips {shortfall} below your safety floor. Right after payday it's fine.",
  ],
  'forecast.runway.ok': [
    "About {months} months — that's your liquid savings divided by your usual monthly burn.",
    "You'd last roughly {months} months at your current spending.",
    "Around {months} months of runway as things stand.",
  ],
  'forecast.prescriptive.suggest': [
    "To free up {target}, your easiest trim is {category} — it's running {over} above usual.",
    "Quickest path to {target}: ease back on {category} ({over} over its norm).",
    "You could find {target} by trimming {category}, which is up {over} lately.",
  ],

  // ── Fallback ────────────────────────────────────────────────────────────────
  'fallback.default': [
    "I didn't quite catch that — want to log something, ask about your spending, or check what you can afford?",
    "Not sure what you meant there. I can capture an expense, explain your numbers, or look ahead — which is it?",
    "Let's try again — tell me an amount to log, or ask me about your money.",
  ],
};

const ESTIMATE_SUFFIXES = [
  " (leaning on a couple of setup estimates — confirm them and I will tighten this).",
  " — that includes some estimates from setup; confirm them for an exact figure.",
  " (a couple of these are still estimates).",
];

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/**
 * Stage 5 — phrase a resolved result in a warm, human voice. Pure: picks a
 * variant by `${intentId}.${outcome}`, interpolates the service-computed values,
 * appends an honest-estimate note when relevant, and never returns a dead end.
 *
 * `seed` rotates the variant so repeated identical questions don't echo verbatim;
 * tests can pass a fixed seed for determinism.
 */
export function phraseResponse(intent: IntentResult, result: ResolveResult, seed = Date.now()): string {
  const key = `${intent.id}.${result.outcome}`;
  // Bucket-level fallback so shared outcomes (e.g. capture.missing_amount) serve
  // every intent in the bucket without duplicating variant arrays per intent id.
  const bucketKey = `${intent.id.split('.')[0]}.${result.outcome}`;
  const variants = VARIANTS[key] ?? VARIANTS[bucketKey] ?? VARIANTS['fallback.default'];
  let text = interpolate(pick(variants, seed), result.vars);
  if (result.usesEstimate) text += pick(ESTIMATE_SUFFIXES, seed);
  return text;
}

/** Exposed for tests: how many phrasing variants exist for an intent+outcome. */
export function variantCount(intentId: string, outcome: string): number {
  return (VARIANTS[`${intentId}.${outcome}`] ?? []).length;
}
