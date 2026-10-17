// The Dashboard's "Learn in a minute" shelf (owner, 16 Oct 2026): two or three lessons, picked for what
// the household is dealing with, readable in place, and a shortcut to the library.
//
// Picks follow the household's own situation first (a loan being repaid, a budget over, no budget yet),
// then saving and household habits. Within a topic the pick rotates by week, so the shelf changes without
// being random on every render. Lessons about one country (the India category) and tax are left out: the
// app is for any household anywhere (owner positioning rule), and Learn already offers them.
import { allEvergreenCards, type EvergreenCard } from './evergreen';

export interface LessonPick { card: EvergreenCard; reason: string }

export interface LearnSituation {
  hasDebt: boolean;
  overBudget: boolean;
  hasBudget: boolean;
}

const eligible = (c: EvergreenCard) => c.category !== 'India' && !/tax/i.test(c.category) && !c.tags.includes('tax');

/** Weeks since 2026-01-05 (a Monday), for a weekly rotation. */
function weekIndex(todayISO: string): number {
  const days = Math.floor((Date.parse(`${todayISO}T00:00:00Z`) - Date.parse('2026-01-05T00:00:00Z')) / 86_400_000);
  return Math.max(0, Math.floor(days / 7));
}

export function dashboardLessons(s: LearnSituation, todayISO: string, n = 3, cards: readonly EvergreenCard[] = allEvergreenCards()): LessonPick[] {
  const pool = cards.filter(eligible);
  const week = weekIndex(todayISO);
  const topics: { tags: string[]; reason: string }[] = [];
  if (s.hasDebt) topics.push({ tags: ['debt'], reason: 'Because you’re repaying a loan' });
  if (s.overBudget) topics.push({ tags: ['budgeting'], reason: 'Because a budget is over this month' });
  else if (!s.hasBudget) topics.push({ tags: ['budgeting'], reason: 'For setting your first budget' });
  topics.push({ tags: ['emergency_fund', 'saving'], reason: 'For building a safety cushion' });
  topics.push({ tags: ['household', 'habit'], reason: 'For running money together' });

  const picked: LessonPick[] = [];
  const used = new Set<string>();
  for (const topic of topics) {
    if (picked.length >= n) break;
    const matches = pool.filter(c => !used.has(c.id) && c.tags.some(t => topic.tags.includes(t)));
    if (!matches.length) continue;
    const card = matches[week % matches.length];
    used.add(card.id);
    picked.push({ card, reason: topic.reason });
  }
  // Short of n (a small library): fill from the rest, rotating the same way.
  const rest = pool.filter(c => !used.has(c.id));
  for (let i = 0; picked.length < n && i < rest.length; i++) {
    const card = rest[(week + i) % rest.length];
    if (used.has(card.id)) continue;
    used.add(card.id);
    picked.push({ card, reason: 'A one-minute read' });
  }
  return picked;
}

/** The lesson's opening in plain text: the first sentence, or the first ~`max` characters at a word. */
export function lessonPreview(bodyMd: string, max = 120): string {
  const text = bodyMd
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')         // links → their text
    .replace(/^#+\s*/gm, '')                         // headings
    .replace(/[*_`>]/g, '')                          // emphasis, code, quotes
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1];
  if (sentence && sentence.length <= max) return sentence;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[,;:\s]+$/, '')}…`;
}
