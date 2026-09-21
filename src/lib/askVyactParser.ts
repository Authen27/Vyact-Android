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
  /**
   * A merchant/source token the user named.
   *
   * v10.20 — this used to say "kept on-device; never sent", which is no longer
   * true in either direction. The user's question is sent verbatim to classify
   * it, so a merchant they typed goes with it; and in the model-backed path
   * this field is FILLED BY the model's extraction rather than by the regex
   * below. It is never trusted for money — `resolve()` re-derives every figure
   * from the household's own data regardless of what came back.
   */
  merchant?: string;
  /** Number of people in a split ("4 ways" → 4, "me and 2 friends" → 3). */
  participantCount?: number;
  /** Rough horizon for forecast questions. */
  horizon?: 'today' | 'this_week' | 'next_week' | 'this_month' | 'next_month' | null;
  /**
   * v10.38 — the period the user named, VERBATIM ("August", "last month",
   * "2026-07"). Filled by the model's extraction in the LLM path.
   *
   * 🔴 It exists because it was previously ignored: `resolve()` hard-coded the
   * current month, so "how much on food in August" was answered with *this*
   * month's figure under an August label — a true number, a false answer, and one
   * the invented-figure guard cannot catch. Read it through `resolvePeriod()`,
   * which returns null rather than guessing.
   */
  period?: string;
  /** v10.38 — a date the user or a bank message stated ("15-Sep-26", "yesterday"). */
  date?: string;
  /** v10.38 — an account the user or a bank message named ("ICICI Bank Card XX3003"). */
  account?: string;
  /** Raw normalised text, for downstream classification. */
  text: string;
}

/** A period resolved to one month of the ledger. */
export interface ResolvedPeriod {
  /** `YYYY-MM`, the key `spendByCategory` and friends take. */
  monthKey: string;
  /** How to name it back to the user ("August 2026", "this month"). */
  label: string;
  isCurrent: boolean;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'] as const;

const monthKeyOf = (year: number, monthIndex0: number): string =>
  `${year}-${String(monthIndex0 + 1).padStart(2, '0')}`;

/**
 * Resolve a stated period to a single month, or null when it cannot be resolved.
 *
 * NULL IS A REAL ANSWER. A period we cannot place must reach the user as "I can't
 * tell which month you mean", never as a silent substitution of the current month.
 * A bare month name resolves to its most recent PAST occurrence, because "in
 * August" asked in September 2026 means August 2026, and asked in March 2026 means
 * August 2025.
 */
export function resolvePeriod(period: string | undefined | null, now = new Date()): ResolvedPeriod | null {
  const currentKey = monthKeyOf(now.getFullYear(), now.getMonth());
  const raw = (period ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (/^(this|current)\s+month$/.test(raw) || raw === 'mtd' || raw === 'month to date') {
    return { monthKey: currentKey, label: 'this month', isCurrent: true };
  }
  if (/^(last|previous)\s+month$/.test(raw)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { monthKey: monthKeyOf(d.getFullYear(), d.getMonth()), label: 'last month', isCurrent: false };
  }
  const iso = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (iso) {
    const monthIndex = Number(iso[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return null;
    const key = monthKeyOf(Number(iso[1]), monthIndex);
    return { monthKey: key, label: `${titleCase(MONTH_NAMES[monthIndex])} ${iso[1]}`, isCurrent: key === currentKey };
  }
  // "august", "aug", "august 2025", "in august"
  const named = /^(?:in\s+)?([a-z]+)(?:\s+(\d{4}))?$/.exec(raw);
  if (named) {
    const monthIndex = MONTH_NAMES.findIndex(m => m === named[1] || m.slice(0, 3) === named[1]);
    if (monthIndex >= 0) {
      const year = named[2]
        ? Number(named[2])
        : (monthIndex > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear());
      const key = monthKeyOf(year, monthIndex);
      return { monthKey: key, label: `${titleCase(MONTH_NAMES[monthIndex])} ${year}`, isCurrent: key === currentKey };
    }
  }
  return null;
}

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Resolve a stated date to `YYYY-MM-DD`, or null.
 *
 * Handles what bank messages actually send (`15-Sep-26`, `15/09/2026`,
 * `2026-09-15`) plus "today"/"yesterday". A future date is refused: a statement
 * describing something that has already happened cannot be dated ahead, and
 * accepting one would push a transaction outside the ledger's range checks.
 */
export function parseDateEntity(value: string | undefined | null, now = new Date()): string | null {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (raw === 'today' || raw === 'tonight') return iso(today);
  if (raw === 'yesterday') return iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));

  let y: number | undefined, m: number | undefined, d: number | undefined;
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const dMonY = /^(\d{1,2})[-/\s]([a-z]{3,})[-/\s](\d{2,4})$/.exec(raw);
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(raw);
  if (ymd) { y = Number(ymd[1]); m = Number(ymd[2]) - 1; d = Number(ymd[3]); }
  else if (dMonY) {
    const monthIndex = MONTH_NAMES.findIndex(name => name.slice(0, 3) === dMonY[2].slice(0, 3));
    if (monthIndex < 0) return null;
    d = Number(dMonY[1]); m = monthIndex;
    y = dMonY[3].length === 2 ? 2000 + Number(dMonY[3]) : Number(dMonY[3]);
  } else if (dmy) {
    d = Number(dmy[1]); m = Number(dmy[2]) - 1;
    y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  } else return null;

  if (m == null || d == null || y == null || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const parsed = new Date(y, m, d);
  // Reject a rolled-over date (31 February) and anything in the future.
  if (parsed.getMonth() !== m || parsed.getDate() !== d) return null;
  if (parsed.getTime() > today.getTime()) return null;
  return iso(parsed);
}

/**
 * Match a stated account against the household's own accounts.
 *
 * Name match first, then the masked tail a bank message carries ("XX3003" →
 * an account whose name or number ends 3003), then the kind word. Returns the
 * account id, or null — a wrong account is worse than an unset one, because the
 * balance it moves is real.
 */
export function matchAccountId(
  stated: string | undefined | null,
  accounts: readonly { id: string; name: string; kind?: string }[],
): string | null {
  const raw = (stated ?? '').trim().toLowerCase();
  if (!raw || accounts.length === 0) return null;
  const byName = accounts.find(a => a.name && raw.includes(a.name.toLowerCase()));
  if (byName) return byName.id;
  const tail = /(\d{3,4})\b(?!.*\d)/.exec(raw);
  if (tail) {
    const digits = tail[1];
    const byTail = accounts.find(a => a.name.replace(/\D/g, '').endsWith(digits));
    if (byTail) return byTail.id;
  }
  const KIND_WORDS: Record<string, string> = {
    'credit card': 'credit_card', card: 'credit_card', bank: 'bank', cash: 'cash',
  };
  for (const [word, kind] of Object.entries(KIND_WORDS)) {
    if (raw.includes(word)) {
      const byKind = accounts.find(a => a.kind === kind);
      if (byKind) return byKind.id;
    }
  }
  return null;
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
  fuel: 'travel', petrol: 'travel', gas: 'travel', uber: 'travel', taxi: 'travel',
  cab: 'travel', ola: 'travel', train: 'travel', bus: 'travel', parking: 'travel',
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
