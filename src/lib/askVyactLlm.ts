// Ask Vyact — model-backed assistant (architecture P3).
//
// This replaces the deterministic classify (stage 3) and phrase (stage 5) stages
// with model calls. Stage 4 — `resolve()` — is deliberately NOT replaced: it
// stays the sole source of every figure. The model chooses WHAT to look up and
// says it in words; it never does arithmetic on money.
//
// That split is the whole safety story. A model that invents "you spent ₹42,000"
// in a finance app is a liability; a model that reads a computed figure aloud is
// not. `assertNoInventedFigures` below enforces it mechanically rather than
// trusting the prompt — prompts are requests, guards are guarantees.
//
// PROVIDER-AGNOSTIC by construction: the only outside dependency is a `ModelCall`
// function, so this module is fully testable with no network, no key and no
// provider, and swapping vLLM for anything OpenAI-compatible changes nothing here.

import type { AssistantContext } from './askVyactBackend';
import type { AssistantIntentId, IntentResult } from './askVyactIntents';
import type { ResolveResult } from './askVyactResponses';

/** The 14 intents `resolve()` implements. The model must return one of these. */
export const INTENT_IDS = [
  'capture.expense', 'capture.income', 'capture.transfer', 'capture.investment',
  'capture.split',
  'interpret.lookup', 'interpret.status', 'interpret.diagnostic',
  'interpret.budgets', 'interpret.debts', 'interpret.bills',
  'forecast.affordability', 'forecast.runway', 'forecast.prescriptive',
  // v10.38 — questions about the ASSISTANT, not the household's money. Without
  // this route they landed on interpret.status, which built the user's net worth,
  // debts and budgets to answer "what do I call you?" — wasted work and an
  // avoidable egress of financial facts.
  'meta.assistant',
] as const;
export type KnownIntentId = typeof INTENT_IDS[number];

const BUCKET_OF: Record<string, IntentResult['bucket']> = {
  capture: 'capture', interpret: 'interpret', forecast: 'forecast',
};

/** One model round-trip. Injected, so tests and evals run offline. */
export interface ModelCall {
  (req: {
    system: string;
    user: string;
    /** Ask for strict JSON. Providers that support it get response_format. */
    json?: boolean;
    maxTokens?: number;
  }): Promise<string>;
}

export class ModelUnavailableError extends Error {
  constructor(cause: string) {
    super(`Ask Vyact could not reach the model: ${cause}`);
    this.name = 'ModelUnavailableError';
  }
}

export class InventedFigureError extends Error {
  readonly offending: string[];
  constructor(offending: string[]) {
    super(`Model reply contained figures no tool produced: ${offending.join(', ')}`);
    this.name = 'InventedFigureError';
    this.offending = offending;
  }
}

// ── stage 3: classify ────────────────────────────────────────────────────────

// v10.36 — each intent now carries its meaning and example phrasings. The model
// used to see bare ids ("interpret.diagnostic", "forecast.prescriptive") with no
// definition, and was told to fall back to interpret.* when unsure — which pulled
// advice questions ("where can I cut back?") into plain lookups. `Valid ids` stays
// interpolated from INTENT_IDS so the machine-checked list can never drift.
export const CLASSIFY_SYSTEM = `You classify a personal-finance question into exactly one intent.

Return ONLY minified JSON: {"id":"<intent>","entities":{...},"confidence":0.0-1.0}

Valid ids: ${INTENT_IDS.join(', ')}

WHAT EACH INTENT MEANS
  capture.expense        recording money already spent       "spent 45 on fuel", "paid rent"
  capture.income         recording money already received    "got paid today", "received salary"
  capture.transfer       moving money between own accounts   "moved money from bank to cash"
  capture.investment     putting money into an investment    "invested in my index fund"
  capture.split          a shared bill split with others     "split dinner three ways"
  interpret.lookup       spend on ONE category or period     "how much on dining this month?"
  interpret.status       overall position or net worth       "how am I doing?", "what's my net worth?"
  interpret.diagnostic   why spending moved, where it goes   "why is spending up?", "where is my money going?"
  interpret.budgets      budget status or budgets at risk    "which budgets are at risk?"
  interpret.debts        debts, balances, payoff strategy    "tell me about my debts", "best way to pay them off"
  interpret.bills        upcoming or recurring bills         "what bills are coming up?"
  forecast.affordability whether a purchase is affordable    "can I afford a new laptop?"
  forecast.runway        how long money lasts without income "how long would my savings last?"
  forecast.prescriptive  where to cut back or how to save    "where can I cut back?", "how do I save more?"
  meta.assistant         about YOU, not their money          "what do I call you?", "why so slow?", "use bullet points"

Entities you may extract when the user states them explicitly:
  amount (number), currency (3-letter code), category (string), account (string),
  toAccount (string), merchant (string), target (string),
  period (string — the month or window they named: "August", "last month", "2026-07"),
  date (string — a date they or a bank message stated: "15-Sep-26", "yesterday")

RULES
- Never invent an entity the user did not state. Omit it instead.
- Copy \`period\` and \`date\` VERBATIM as the user wrote them. Do not translate a
  month into a number or resolve it yourself — the app resolves them.
- A question about the assistant itself (its name, speed, formatting, what it can
  do) is meta.assistant, never interpret.*: those fetch the household's finances,
  which a question about the assistant has no need of.
- capture.* ONLY when the user is recording a transaction that already happened.
- A request for advice, a strategy, or where to save is forecast.prescriptive (or
  interpret.debts for debt payoff) — never interpret.lookup.
- If genuinely unsure, choose the closest meaning and set confidence below 0.5.
- Output JSON only. No prose, no markdown, no code fences.`;

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/**
 * Ask the model which intent this is. Entities are extracted but NEVER trusted
 * for money: `resolve()` re-derives every figure from the household's own data.
 */
export async function classifyIntentViaModel(
  utterance: string,
  _ctx: AssistantContext,
  call: ModelCall,
): Promise<IntentResult> {
  let raw: string;
  try {
    raw = await call({ system: CLASSIFY_SYSTEM, user: utterance, json: true, maxTokens: 256 });
  } catch (err) {
    throw new ModelUnavailableError(err instanceof Error ? err.message : String(err));
  }

  let parsed: { id?: unknown; entities?: unknown; confidence?: unknown };
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    // A model that cannot produce JSON cannot be trusted to have understood the
    // question either. Fall through to the caller's fallback rather than guess.
    return { id: 'fallback', bucket: 'none', entities: { text: utterance }, confidence: 0 };
  }

  const id = typeof parsed.id === 'string' ? parsed.id : '';
  if (!(INTENT_IDS as readonly string[]).includes(id)) {
    return { id: 'fallback', bucket: 'none', entities: { text: utterance }, confidence: 0 };
  }

  // `text` is always the user's own words, never the model's paraphrase.
  const entities: IntentResult['entities'] = {
    ...(parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {}),
    text: utterance,
  };
  const confidence = typeof parsed.confidence === 'number'
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.5;

  return {
    id: id as AssistantIntentId,
    bucket: BUCKET_OF[id.split('.')[0]] ?? 'none',
    entities,
    confidence,
  };
}

// ── the anti-hallucination guard ─────────────────────────────────────────────

/**
 * Small counts and calendar quantities that legitimately appear in prose:
 * "2 categories", "30 days", "12 months".
 *
 * `100` was here and has been REMOVED. In a finance assistant it is the single
 * most likely figure for a model to confabulate — "100% of your budget" — and it
 * almost never needs the exemption, because a genuine 100 arrives inside a
 * computed value ("Your Pulse Score is 85/100") and is therefore already
 * allowed. Exempting it bought nothing and cost the guard its most obvious case.
 */
const HARMLESS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '24', '30', '31']);

/**
 * A currency marker immediately before a number: `£2,050`, `Rs. 1999`, `INR 2020`.
 * Used to stop the year exemption swallowing money — see `assertNoInventedFigures`.
 */
const CURRENCY_PREFIX = /(?:[£$€₹¥]|\b(?:rs|inr|usd|gbp|eur|aed|sgd|aud|cad|jpy)\.?)\s*$/i;

interface Figure { value: string; index: number; }

/** Every numeric token in a string, commas stripped, with its position so the
 *  caller can look at what precedes it. */
function figuresWithPos(text: string): Figure[] {
  const out: Figure[] = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || '')) !== null) {
    out.push({ value: m[0].replace(/,/g, ''), index: m.index });
  }
  return out;
}

/** Values only — for scanning the computed `vars`, where position is irrelevant. */
function figuresIn(text: string): string[] {
  return figuresWithPos(text).map(f => f.value);
}

/**
 * THE "SERVICES COMPUTE" GUARD, mechanised.
 *
 * Every money-shaped figure in the model's reply must trace back to a value
 * `resolve()` produced. A hallucinated total cannot reach the user, because it
 * did not come from a tool.
 *
 * ⚠️ WHAT THIS DOES **NOT** PROVE — state it here so nobody writes UI copy that
 * claims more than the code delivers (which is exactly what happened in v10.20):
 *
 *   · It matches TOKENS, not meaning. A figure that came from the tools but is
 *     described with the wrong sign, unit, or framing — income narrated as debt,
 *     "up" for "down" — passes cleanly.
 *   · Small counts stay exempt (`HARMLESS`), so "3 budgets are over" can still be
 *     wrong about the 3.
 *   · A magnitude word next to a right number ("2.4 million") is not checked.
 *
 * It is defence in depth against fabricated amounts. It is not proof that every
 * financial statement in a reply is correct, and the honest end state is the one
 * the audit describes: services return facts with units, the UI renders the
 * amounts, and the model only explains them.
 */
/**
 * v10.38 — figures the guard accepts on top of what the tools computed.
 *
 * Validation showed the guard destroying three CORRECT answers in sixteen, each
 * for a figure that was real but absent from that turn's data: one quoted from the
 * PREVIOUS turn (the correction to a contradictory cover figure — the most useful
 * answer of the session, lost), one quoting the user's OWN words back to them
 * ("spent 45 on groceries"), and one that was simply a date ("13 September").
 * Rejection replaces the whole reply, so the user saw "I can't verify" and never
 * the sentence. None of these is an invented figure; all three are now allowed.
 */
export interface FigureGuardOptions {
  /** The user's own utterance — a number they typed is theirs to hear back. */
  question?: string;
  /** Figures the PREVIOUS assistant turn was allowed to use (one turn only). */
  alsoAllowed?: readonly string[];
}

/** A date, not money: "13 September", "15-Sep-26", "13/09", "September 13". */
function looksLikeDate(reply: string, index: number, value: string): boolean {
  if (value.includes('.') || Number(value) > 31 || Number(value) < 1) return false;
  const before = reply.slice(Math.max(0, index - 14), index).toLowerCase();
  const after = reply.slice(index + value.length, index + value.length + 14).toLowerCase();
  const MONTH = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/;
  if (CURRENCY_PREFIX.test(reply.slice(0, index))) return false;      // money wins
  if (MONTH.test(after) || MONTH.test(before)) return true;
  return /\d\s*[-/]\s*$/.test(before) || /^\s*[-/]\s*\d/.test(after); // 13/09, 15-09
}

export function assertNoInventedFigures(
  reply: string,
  vars: Record<string, string | number>,
  opts: FigureGuardOptions = {},
): void {
  // Everything the tools computed, normalised the same way as the reply.
  const allowed = new Set<string>();
  const admit = (raw: string) => {
    for (const f of figuresIn(raw)) {
      allowed.add(f);
      // Accept 850 for a computed 850.00 and vice versa.
      if (f.includes('.')) allowed.add(f.replace(/\.0+$/, ''));
      else allowed.add(`${f}.00`);
    }
  };
  for (const v of Object.values(vars ?? {})) admit(String(v));
  if (opts.question) admit(opts.question);
  for (const f of opts.alsoAllowed ?? []) admit(String(f));

  const offending = figuresWithPos(reply).filter(({ value: f, index }) => {
    if (allowed.has(f) || HARMLESS.has(f)) return false;
    if (f.includes('.') && allowed.has(f.replace(/\.0+$/, ''))) return false;
    if (!f.includes('.') && allowed.has(`${f}.00`)) return false;
    // A bare 4-digit number in a sentence is far more likely a year than a
    // total — but ONLY when it is not presented as money. This exemption used to
    // be unconditional, which meant the entire 1900–2099 band sailed through:
    // "You spent £2,050 on rent" and "Your net worth is £1,999" both passed the
    // guard completely un-computed. That is a realistic amount range, not a
    // theoretical one, and it was the largest hole in this function.
    if (/^(19|20)\d{2}$/.test(f) && !CURRENCY_PREFIX.test(reply.slice(0, index))) return false;
    // A day-of-month next to a month name is a date, not a sum (v10.38).
    if (looksLikeDate(reply, index, f)) return false;
    return true;
  }).map(f => f.value);

  if (offending.length > 0) throw new InventedFigureError([...new Set(offending)]);
}

// ── stage 5: phrase ──────────────────────────────────────────────────────────

// v10.36 — rewritten. The previous prompt capped answers at "one or two short
// sentences" and forbade advice outright, so questions that ASK for advice ("where
// can I cut back?", "best payoff strategy") could only get a restated number. The
// money rule is unchanged and still absolute: the model explains figures Vyact
// computed; it never produces one. Relaxing THAT would break the binding
// "services compute" rule, and assertNoInventedFigures still enforces it.
export const PHRASE_SYSTEM = `You are Vyact's household-finance assistant. You are given
the user's QUESTION and FACTS that Vyact has already computed from their own data.
Answer the question they actually asked, using those facts.

HOW TO ANSWER
- Lead with the direct answer, then explain the supporting facts that matter most.
- When there are several items (categories, budgets, debts, bills), name the ones
  that matter most, in order of importance, and say why each matters.
- For where-to-save questions, point to the specific categories that are highest or
  furthest above the user's usual, citing their figures.
- For debt questions, say which debt to prioritise and why, using the balances and
  interest rates given.
- Two to five sentences, and prefer the shorter end: one idea per sentence, no
  preamble, no restating the question.
- Plain language, warm and direct. Speak to the user as "you".
- No markdown, no bullet points, no headings, no emoji.

WHEN THE FACTS DO NOT COVER THE QUESTION
- FACTS carrying \`cannot_answer_yet\` means Vyact cannot compute what was asked.
  Say so in the first sentence, plainly and without apology, then offer the closest
  thing from \`can_answer\` that would actually help. Never approximate the answer
  from figures that describe something else.
- \`period\` names the window every figure belongs to. If it is not the window the
  user asked about, say which window you are reporting before giving any figure.
- \`months_considered\` says how much history an average rests on. When an answer
  leans on a typical-month figure, say what it is based on.
- FACTS with \`outcome: "needs_period"\` means the month could not be identified: ask
  which month they mean, and state that a named month or "last month" works.

ABSOLUTE RULES ABOUT NUMBERS
- Use ONLY figures that appear in FACTS or DATA, copied exactly as written: same
  currency symbol, same rounding. Never calculate, estimate, total, convert, round
  or infer a new figure. If a number is not given, do not state one.
- Describe relationships in words ("your largest", "well above your usual") rather
  than inventing a number for them.
- You are explaining the user's own data, not giving regulated investment, tax or
  legal advice. Do not recommend specific financial products.
- If FACTS show something is missing, say plainly what you need from the user.`;

/**
 * Turn a computed `ResolveResult` into prose.
 *
 * The model sees the user's own question plus COMPUTED aggregates — never the raw
 * transaction list — so it cannot leak detail the summary deliberately excludes,
 * and cannot base a figure on anything but a computed one.
 */
export async function phraseViaModel(
  intent: IntentResult,
  result: ResolveResult,
  call: ModelCall,
  /** Figures the previous assistant turn was allowed to use (v10.38). */
  prevAllowed: readonly string[] = [],
): Promise<string> {
  // v10.36 — `question` and `facts` are new. The model previously never saw the
  // question it was answering (only `question_type`), so it answered the intent
  // CATEGORY rather than what was asked. `data` is kept, and kept under that key,
  // deliberately: it is the legacy one-line summary, and the offline test fakes
  // read `JSON.parse(user).data`.
  const payload = JSON.stringify({
    question: intent.entities.text,
    question_type: intent.id,
    outcome: result.outcome,
    facts: result.facts ?? {},
    data: result.vars ?? {},
  });

  const guardVars = {
    ...(result.vars ?? {}),
    __facts: JSON.stringify(result.facts ?? {}),
  };
  const guardOpts = {
    question: typeof intent.entities.text === 'string' ? intent.entities.text : undefined,
    alsoAllowed: prevAllowed,
  };

  const ask = async (extraSystem = ''): Promise<string> => {
    let raw: string;
    try {
      // 200 → 700: room for a real explanation. Reasoning tokens are metered
      // separately and are not bound by this visible-output cap.
      raw = (await call({ system: PHRASE_SYSTEM + extraSystem, user: payload, maxTokens: 700 })).trim();
    } catch (err) {
      throw new ModelUnavailableError(err instanceof Error ? err.message : String(err));
    }
    const cleaned = stripFences(raw);
    if (!cleaned) throw new ModelUnavailableError('empty reply');
    return cleaned;
  };

  // Guard, then return. A reply that invents money is discarded, never shown. The
  // allowlist includes every figure in `facts` (flattened via JSON), the user's own
  // question, and the previous turn's figures.
  //
  // v10.38 — ONE retry before giving up. A rejection used to replace the entire
  // answer with "I can't verify that", so a single stray number cost the user a
  // whole correct explanation. Naming the offending figures back to the model fixes
  // most slips; a second failure still refuses, because showing an invented figure
  // in a finance app is the one outcome this system exists to prevent.
  const reply = await ask();
  try {
    assertNoInventedFigures(reply, guardVars, guardOpts);
    return reply;
  } catch (err) {
    if (!(err instanceof InventedFigureError)) throw err;
    const retry = await ask(
      `\n\nIMPORTANT: your previous attempt was rejected for using figures that are not in FACTS: ${err.offending.join(', ')}. `
      + 'Write the answer again without those numbers. Use only figures that appear in FACTS or DATA, copied exactly.',
    );
    assertNoInventedFigures(retry, guardVars, guardOpts);
    return retry;
  }
}
