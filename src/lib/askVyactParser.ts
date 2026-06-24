// Vyact — Ask Vyact parser (engineering spec §3, stages 1–2).
//
// Pure, model-agnostic string → structured entities. These two stages are
// reused forever: a future LlmBackend inherits them unchanged (only stages 3
// `classifyIntent` and 5 `phraseResponse` are ever swapped for a model). Nothing
// here touches money — extraction only surfaces what the user *said*; the
// resolve stage (§stage 4) is the single source of computed truth.
//
// No PII ever leaves the device — there is no network call in this pipeline.

// ── [1] normalise ─────────────────────────────────────────────────────────────

/** Pure string hygiene: lowercase, collapse whitespace, normalise currency
 *  symbols and unicode punctuation. Leaves digits/words intact for extraction. */
export function normalise(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[‘’“”]/g, "'")  // smart quotes → '
    .replace(/[–—]/g, '-')               // en/em dash → -
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ── [2] entityExtract ───────────────────────────────────────────────────────

export interface ExtractedEntities {
  /** Amount in major units (e.g. 1200, 85000). undefined when none found. */
  amount?: number;
  /** Best-guess category id (from KEYWORD_MAP), undefined when none matched. */
  category?: string;
  /** A merchant/source token the user named (kept on-device; never sent). */
  merchant?: string;
  /** Number of people in a split ("4 ways" → 4, "me and 2 friends" → 3). */
  participantCount?: number;
  /** Rough horizon for forecast questions. */
  horizon?: 'today' | 'this_week' | 'next_week' | 'this_month' | 'next_month' | null;
  /** Raw normalised text, for downstream classification. */
  text: string;
}

// Keyword → category id. Small, contained, and order-independent (longest
// keyword wins on overlap). Mirrors the category ids in constants.ts. This is
// the "reuse KEYWORD_MAP" hook from the spec; extend per launch market.
// v9 — keys map to the type-scoped category ids in the txn-redesign spec §3.
const KEYWORD_MAP: Record<string, string> = {
  // food & dining
  coffee: 'food_dining', lunch: 'food_dining', dinner: 'food_dining', breakfast: 'food_dining',
  restaurant: 'food_dining', dining: 'food_dining', food: 'food_dining', eat: 'food_dining',
  'eating out': 'food_dining', starbucks: 'food_dining', mcdonalds: 'food_dining',
  swiggy: 'food_dining', zomato: 'food_dining', takeaway: 'food_dining',
  // groceries (its own category in v9)
  groceries: 'groceries', grocery: 'groceries', supermarket: 'groceries',
  // transport
  fuel: 'transport', petrol: 'transport', gas: 'transport', uber: 'transport', taxi: 'transport',
  cab: 'transport', ola: 'transport', train: 'transport', bus: 'transport', parking: 'transport',
  // shopping
  amazon: 'shopping', shopping: 'shopping', clothes: 'shopping', shoes: 'shopping', flipkart: 'shopping',
  // entertainment / subscriptions
  netflix: 'entertainment', spotify: 'entertainment', movie: 'entertainment', cinema: 'entertainment',
  prime: 'entertainment', subscription: 'entertainment', game: 'entertainment',
  // health
  pharmacy: 'health', doctor: 'health', gym: 'health', medicine: 'health', dentist: 'health',
  // utilities / bills
  electricity: 'utilities', water: 'utilities', internet: 'utilities', phone: 'utilities',
  bill: 'utilities', bills: 'utilities', wifi: 'utilities', broadband: 'utilities',
  // housing
  rent: 'rent_mortgage', mortgage: 'rent_mortgage',
  // loan / EMI — system-split category (§4.1)
  emi: 'loan_emi', 'loan payment': 'loan_emi', loan: 'loan_emi',
  // education / childcare / travel / insurance
  school: 'education', course: 'education', tuition: 'education', books: 'education',
  childcare: 'childcare', daycare: 'childcare', nanny: 'childcare',
  flight: 'travel', hotel: 'travel', trip: 'travel', holiday: 'travel', vacation: 'travel',
  insurance: 'insurance', premium: 'insurance',
  // income
  salary: 'salary', paid: 'salary', payday: 'salary', wage: 'salary',
  freelance: 'freelance', client: 'freelance', invoice: 'freelance',
  bonus: 'gift_bonus', gift: 'gift_bonus', refund: 'other_income',
};

const KEYWORDS_BY_LEN = Object.keys(KEYWORD_MAP).sort((a, b) => b.length - a.length);

/** Parse an amount, supporting k / lakh / cr shorthands and grouping commas.
 *  "10k" → 10000, "2.5k" → 2500, "3 lakh"/"3l" → 300000, "1,200" → 1200,
 *  "5 bucks" → 5, "85000" → 85000. Returns undefined when no number present. */
export function parseAmount(text: string): number | undefined {
  // Strip currency symbols/words so the numeric matcher is clean.
  const t = text.replace(/[$£€₹]/g, ' ').replace(/\b(rs|inr|usd|gbp|eur|bucks?|rupees?|dollars?|quid)\b/gi, ' ');
  // number + optional scale suffix (k, lakh/lac/l, cr/crore, m)
  const m = t.match(/(\d[\d,]*\.?\d*)\s*(k|lakhs?|lacs?|l|cr|crores?|m|mn)?\b/i);
  if (!m) return undefined;
  const base = Number(m[1].replace(/,/g, ''));
  if (!isFinite(base)) return undefined;
  const scale = (m[2] || '').toLowerCase();
  let mult = 1;
  if (scale === 'k') mult = 1_000;
  else if (scale === 'm' || scale === 'mn') mult = 1_000_000;
  else if (scale === 'l' || scale.startsWith('lakh') || scale.startsWith('lac')) mult = 100_000;
  else if (scale === 'cr' || scale.startsWith('crore')) mult = 10_000_000;
  const value = base * mult;
  return value > 0 ? Math.round(value * 100) / 100 : undefined;
}

/** "split 3600 4 ways" → 4; "between me and 2 friends" → 3; "dinner 80 with 3 of us" → 3. */
export function parseParticipantCount(text: string): number | undefined {
  const ways = text.match(/(\d+)\s*ways?\b/);
  if (ways) return Math.max(2, Number(ways[1]));
  // "me and N (friends/others/people)" → N + 1 (the user)
  const meAndN = text.match(/\bme\s+and\s+(\d+)\b/);
  if (meAndN) return Number(meAndN[1]) + 1;
  // "N of us" / "between N"
  const ofUs = text.match(/(\d+)\s*of\s*us\b/) || text.match(/\bbetween\s+(\d+)\b/);
  if (ofUs) return Math.max(2, Number(ofUs[1]));
  return undefined;
}

function parseHorizon(text: string): ExtractedEntities['horizon'] {
  if (/\b(today|tonight|right now)\b/.test(text)) return 'today';
  if (/\bnext week\b/.test(text)) return 'next_week';
  if (/\bthis week\b/.test(text)) return 'this_week';
  if (/\bnext month\b/.test(text)) return 'next_month';
  if (/\bthis month\b/.test(text)) return 'this_month';
  return null;
}

/** Longest-match category lookup over the keyword map. */
export function matchCategory(text: string): string | undefined {
  for (const kw of KEYWORDS_BY_LEN) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(text)) return KEYWORD_MAP[kw];
  }
  return undefined;
}

/** Best-effort merchant token: the keyword the category matched on (so the
 *  modal can prefill a friendly description). Never transmitted off-device. */
function matchMerchant(text: string): string | undefined {
  for (const kw of KEYWORDS_BY_LEN) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(text)) return kw;
  }
  return undefined;
}

/** Stage 2 — extract structured entities from already-normalised text. Pure. */
export function entityExtract(normalisedText: string): ExtractedEntities {
  return {
    amount: parseAmount(normalisedText),
    category: matchCategory(normalisedText),
    merchant: matchMerchant(normalisedText),
    participantCount: parseParticipantCount(normalisedText),
    horizon: parseHorizon(normalisedText),
    text: normalisedText,
  };
}

/** Convenience: stages 1 + 2 together. */
export function parse(raw: string): ExtractedEntities {
  return entityExtract(normalise(raw));
}
