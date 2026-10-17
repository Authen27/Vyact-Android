// Vyact — Pip's response contract: chips and the resolved-turn shape (stage 4 → 5).
//
// v10.46.0 (W5) — the rotating phrase tables that lived here (`VARIANTS`,
// `phraseResponse`, 19 outcomes × 3 phrasings) were REMOVED. Since v10.20 the model
// phrases every answer and v10.38 acknowledges captures deterministically, so none of
// that copy had reached a user; the responses spec still described it as shipping.
// How Pip speaks is now ONE contract in `PHRASE_SYSTEM` (askVyactLlm.ts), the same
// for the app and WhatsApp. See `vyact-ask-vyact-responses-spec.md`.
//
// What stays here is the part both channels render the same way: chips (max three,
// each must ask something, never model-authored) and the numbered-list rendering
// WhatsApp uses, plus the `ResolveResult` shape stage 4 returns.
//
// COPY CANNOT INTRODUCE A FIGURE THE ENGINE DOES NOT COMPUTE: a reply carrying an
// unbacked number is DISCARDED by `assertNoInventedFigures`, so it fails closed.

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
 * Used by WhatsApp since v10.45.0 through `serverEngine.renderForWhatsApp`. Not
 * ported: the server runs this very function, bundled into
 * `supabase/functions/_shared/agent/engine.generated.js`.
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
/**
 * v10.39.1 (P21) — a recurring bill described in chat, handed to the Recurring
 * section's own form. Like a transaction seed it is a PROPOSAL: the schedule exists
 * only once the user picks the paying account and saves (writes are propose →
 * confirm). Base currency only — a foreign amount is converted before it gets here.
 */
export interface RecurringSeed {
  name: string;
  type: 'expense' | 'income';
  amount: number;
  category: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** 1–31, monthly schedules only, when the user named a day. */
  dayOfMonth?: number;
}

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
  /** v10.39.1 (P21) — the draft for the Recurring schedule sheet. Never saved here. */
  recurringSeed?: RecurringSeed;
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
   * v10.47.0 — the same figures as raw numbers, for a channel that renders them into
   * a fixed layout (the WhatsApp affordability card). Never shown to the model; the
   * values are exactly the ones `facts` formats, so a card and a reply cannot differ.
   */
  amounts?: Record<string, number>;
  /**
   * Human-readable description of what `resolve()` examined and found, shown
   * live as the "analysis" steps while the model writes. Deterministic and
   * derived from the same computation — never model-authored text.
   */
  analysis?: string[];
}
