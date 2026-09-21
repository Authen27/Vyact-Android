// Vyact — Ask Vyact response/tone layer (engineering spec §7, stage 5).
//
// This is the SECOND of the two seams a future LlmBackend swaps in (the
// `phraseResponse` interface, §3). Tone lives here and ONLY here — tuning the
// voice never touches extraction (stages 1–2) or computation (stage 4).
//
// Rules baked in (§7): answer-first, specific, open-ended (always a next step),
// warm-not-chummy, honest about estimates.
//
// 📖 BEFORE CHANGING COPY HERE, read `vyact-ask-vyact-responses-spec.md` at the
// repo root. It reconciles this file against the design deck in
// `WhatsApp & Ask Vyact Message Templates/…/Vyact - Ask Vyact Responses.html`
// and records which side wins where they disagree. Two things it settles that
// are easy to get wrong from this file alone:
//
//   * VARIANT COUNT IS NO LONGER UNIFORM. The ≥3 rotating phrasings stay only
//     for the turns a user actually repeats — capture confirmations and the
//     missing-amount ask. Everything else moves to ONE composed response in the
//     deck's four-part anatomy. Do not "tidy" one convention into the other.
//   * COPY CANNOT INTRODUCE A FIGURE THE ENGINE DOES NOT COMPUTE. A reply
//     carrying an unbacked number is DISCARDED by `assertNoInventedFigures`, so
//     it fails closed rather than degrading. Several designed responses are
//     blocked on engine work for exactly this reason — see §2 of that doc.

import type { IntentResult } from './askVyactIntents';
import type { Transaction } from '../types';

// ── Chips — the "next question", not navigation (deck §4, ticket #62) ──────────
//
// A chip is a follow-up the user can take in ONE tap. The design rule, verbatim
// from the response deck: *"Chips are the next question, not navigation. 'Why is
// it up?' beats 'Open reports'. Max three, and never a chip that just repeats the
// answer."*
//
// 🔒 A CHIP IS NEVER MODEL-AUTHORED. Chips are produced by `resolve()` (stage 4)
// alongside the figures, and are NOT part of what stage 5 phrases — the model is
// handed `result.vars` and nothing else. That matters: `assertNoInventedFigures`
// guards prose, not chips, so a model-written chip label would be an unguarded
// path for an invented number to reach the user. Keeping chip authorship in
// stage 4 closes that hole by construction rather than by another check.
export interface AssistantChip {
  /** What the user reads on the pill. Short — it sits in a row of up to three. */
  label: string;
  /**
   * What gets SENT as the next turn when the chip is tapped. Required: a chip
   * the user can tap but that asks nothing is a dead end, and the open-ended
   * rule exists precisely to avoid those. Write it as a user would type it —
   * it goes through the same classifier as anything typed into the box.
   */
  prompt: string;
}

/** The deck's cap. Enforced centrally in `normaliseChips`, not per call site. */
export const MAX_CHIPS = 3;

/**
 * The single gate every chip list passes before it can reach any channel.
 *
 * Applied at the orchestrator boundary (`runAssistant`) rather than trusting
 * each `resolve()` branch to behave, so the cap holds for chips authored later
 * — including by a channel adapter or a future tool — without revisiting this
 * rule at every site.
 *
 * Drops (rather than repairs) anything malformed: an empty label or an empty
 * prompt is a bug at the call site, and rendering a broken chip would hide it.
 * Returns `undefined` rather than `[]` so "no chips" is one value everywhere.
 */
export function normaliseChips(chips?: AssistantChip[]): AssistantChip[] | undefined {
  if (!chips?.length) return undefined;
  const seen = new Set<string>();
  const kept: AssistantChip[] = [];
  for (const c of chips) {
    const label = c?.label?.trim();
    const prompt = c?.prompt?.trim();
    if (!label || !prompt) continue;
    // Two chips that ask the same thing waste one of only three slots.
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ label, prompt });
    if (kept.length === MAX_CHIPS) break;   // extras DROPPED, never wrapped
  }
  return kept.length ? kept : undefined;
}

/**
 * The second rendering of the same definition (CONV-09): WhatsApp has no chips,
 * so the identical list becomes numbered options the user answers with a digit.
 *
 * One definition, two renderings — the in-app row and this string are built from
 * the same `AssistantChip[]`, so a chip cannot exist on one channel only.
 *
 * NOTE: no WhatsApp caller exists yet — the webhook is still write-only and
 * hard-blocks queries (v10.18). This ships with the contract so that wiring the
 * agent into the webhook is a call site, not a redesign. When that lands it must
 * be PORTED to `supabase/functions/_shared/` under a parity test, the way
 * `whatsapp-parser.ts` was — Deno cannot import from `react/src`.
 */
export function renderChipsAsNumberedList(chips?: AssistantChip[]): string {
  const list = normaliseChips(chips);
  if (!list) return '';
  return list.map((c, i) => `${i + 1}. ${c.label}`).join('\n');
}

/** Resolve a WhatsApp-style numeric reply ("2") back to the chip's prompt.
 *  Returns null for anything that is not a valid 1-based index into THIS list —
 *  a user who types a sentence instead of a digit is asking something new, not
 *  answering the list, and must not be silently answered with a chip. */
export function chipPromptFromReply(reply: string, chips?: AssistantChip[]): string | null {
  const list = normaliseChips(chips);
  if (!list) return null;
  const m = /^\s*([1-9])\s*[.)]?\s*$/.exec(reply);
  if (!m) return null;
  return list[Number(m[1]) - 1]?.prompt ?? null;
}

/** The deterministic outcome of stage 4 (`resolve`). Carries pre-formatted
 *  interpolation values and a variant key — NEVER raw template-computed money
 *  (every figure in `vars` came from a Vyact service). */
export interface ResolveResult {
  kind: 'capture' | 'interpret' | 'forecast' | 'fallback';
  /** Variant selector, e.g. 'fits' | 'tight' | 'no' | 'missing_amount' | 'ok'. */
  outcome: string;
  /** Pre-formatted strings for `{token}` interpolation in the variant. */
  vars: Record<string, string | number>;
  /**
   * Up to three one-tap next steps shown under the reply (open-ended rule).
   * Was a single optional `chip` that no consumer ever read — see #62.
   */
  chips?: AssistantChip[];
  /** Capture only — the seed for the existing TransactionFormModal. */
  seed?: Partial<Transaction>;
  /** True when any figure leans on onboarding estimates (provenance, §5). */
  usesEstimate?: boolean;
  /**
   * v10.36 — structured, service-computed facts for the model to EXPLAIN.
   *
   * `vars` was sized to fill one canned sentence for the retired rules engine, so
   * the model inherited a pre-written `{headline} {detail}` and could only
   * paraphrase it — the root cause of shallow answers. `facts` carries the data
   * `resolve()` already computes (every category, budget, debt, bill) instead of
   * collapsing it to the single top item.
   *
   * Every money value is pre-formatted through the same `money()` rounding as
   * `vars`. That is load-bearing: the invented-figure guard only allows numbers
   * it finds in the data, so a figure the model copies verbatim from here always
   * passes. `vars` is kept unchanged for the template path and existing tests.
   */
  facts?: Record<string, unknown>;
  /**
   * Human-readable description of what `resolve()` examined and found, shown
   * live as the "analysis" steps while the model writes. Deterministic and
   * derived from the same computation — never model-authored text.
   */
  analysis?: string[];
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
