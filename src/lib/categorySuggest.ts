// Aurora 4.0 CAT2 / CAT3 — what the category picker suggests and lists first.
//
// CAT2 (alternative B′): the description fills the category select with a suggestion that says where it
// came from ("Suggested from Swiggy"). The words come from Pip's keyword list (`matchCategory`), so the
// form and Pip place an entry the same way. A suggestion is only ever a category of the entry's own
// type, and never Loan / EMI: an EMI pays a loan, which the form asks for explicitly.
// CAT3: the household's most used categories of the type (last 90 days), shown first.
import { CATEGORIES_BY_TYPE } from '../constants';
import { matchCategory } from './askVyactParser';
import { addDaysISO } from './format';
import type { TxnType } from '../types';

export interface CategorySuggestion {
  category: string;
  /** The user's own word(s) the suggestion came from, as typed. */
  word: string;
}

const NEVER_SUGGESTED = new Set(['loan_emi']);

function offered(type: TxnType, id: string): boolean {
  if (type !== 'expense' && type !== 'income') return false;
  return !NEVER_SUGGESTED.has(id) && CATEGORIES_BY_TYPE[type].some(c => c.id === id);
}

/** The category a description points to, for this type, or null. Two-word phrases ("eating out")
 *  are tried before single words, then words in the order they were typed. */
export function suggestCategory(description: string, type: TxnType): CategorySuggestion | null {
  if (type !== 'expense' && type !== 'income') return null;
  const words = description.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const phrases: string[] = [];
  for (let i = 0; i + 1 < words.length; i++) phrases.push(`${words[i]} ${words[i + 1]}`);
  const clean = (s: string) => s.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim();
  for (const phrase of [...phrases, ...words]) {
    const text = clean(phrase);
    if (!text) continue;
    // A pair counts only as a phrase keyword ("eating out"), not because one of its words matches —
    // that word is named on its own below, so the hint quotes "Swiggy", not "Swiggy order".
    if (phrase.includes(' ') && phrase.split(' ').some(w => clean(w) && matchCategory(clean(w).toLowerCase()))) continue;
    const id = matchCategory(text.toLowerCase());
    if (id && offered(type, id)) return { category: id, word: text };
  }
  return null;
}

/** The household's most used categories of `type` over the last 90 days, most used first. */
export function recentCategories(
  txns: readonly { type: TxnType; category?: string | null; date: string }[],
  type: TxnType,
  todayISO: string,
  limit = 5,
): string[] {
  if (type !== 'expense' && type !== 'income') return [];
  const since = addDaysISO(todayISO, -90);
  const tally = new Map<string, { n: number; last: string }>();
  for (const t of txns) {
    if (t.type !== type || !t.category || t.date < since || t.date > todayISO) continue;
    if (!CATEGORIES_BY_TYPE[type].some(c => c.id === t.category)) continue;
    const prev = tally.get(t.category);
    tally.set(t.category, { n: (prev?.n ?? 0) + 1, last: prev && prev.last > t.date ? prev.last : t.date });
  }
  return [...tally.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}
