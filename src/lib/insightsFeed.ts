// Vyact — personal-insight feed engine ("For You", Insights Hub §3, v9.5.3).
//
// Push, not pull: the Ask Vyact "interpret" idea flipped into a generated feed.
// Strictly LLM-free and "services compute, never fabricate" — every number comes
// from the EXISTING aggregation helpers (monthlyData / spendByCategory / Pulse).
// This module adds NO financial math; it only frames existing aggregates as cards,
// ranks them by materiality, and enforces the neutral→positive tone mix (§5).
import type { Transaction, Budget, Goal, Debt, Asset, ExchangeRates } from '../types';
import { monthlyData, spendByCategory, computePulseScore, totalMonthlyDebtPayment } from './calculations';
import { getMonthKey, nowMonthKey, fmtShort } from './format';
import { getCat } from '../constants';
import { evergreenByTag } from './evergreen';

export type FeedTone = 'neutral' | 'positive' | 'constructive';
export type FeedType = 'mirror' | 'win' | 'trend' | 'forecast' | 'pulse' | 'anomaly' | 'nudge_to_learn';

export interface FeedCard {
  /** Stable per (template, period) so the same insight isn't a new card each render. */
  id: string;
  type: FeedType;
  tone: FeedTone;
  emoji: string;
  /** The 5-second hero line — a big number or short phrase. */
  big: string;
  /** One supporting sentence. */
  line: string;
  /** Optional CTA route (tap to dig into the underlying detail). */
  to?: string;
  /** Optional evergreen card id to surface contextually (nudge_to_learn). */
  learnId?: string;
  /** Ranking weight (higher = more material). */
  materiality: number;
}

export interface FeedInput {
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  debts: Debt[];
  assets: Asset[];
  baseCurrency: string;
  rates: ExchangeRates;
}

const prevMonthKeys = (txns: Transaction[], n: number): string[] =>
  [...new Set(txns.map(t => getMonthKey(t.date)))].sort().filter(m => m !== nowMonthKey()).slice(-n);

/** Build the candidate feed, ranked + tone-mixed, capped to `limit` (default 5).
 *  Pure + deterministic: no Math.random, so the same data yields the same feed. */
export function buildInsightFeed(input: FeedInput, limit = 5): FeedCard[] {
  const { transactions, budgets, goals, debts, assets, baseCurrency, rates } = input;
  const mk = nowMonthKey();
  const C = (n: number) => fmtShort(n, baseCurrency);
  const cards: FeedCard[] = [];

  const { income, expense } = monthlyData(transactions, mk, baseCurrency, rates);
  const spend = spendByCategory(transactions, mk, baseCurrency, rates);

  // ── win / mirror: savings rate this month ──────────────────────────────────
  if (income > 0) {
    const rate = Math.round((income - expense) / income * 100);
    if (rate >= 20) {
      cards.push({ id: `win-savings-${mk}`, type: 'win', tone: 'positive', emoji: '💚',
        big: `${rate}% saved`, line: `You've kept ${C(income - expense)} of your income this month. Strong rate — keep it parked.`,
        to: '/reports?from=savings', materiality: 70 });
    } else {
      cards.push({ id: `mirror-savings-${mk}`, type: 'mirror', tone: 'neutral', emoji: '📊',
        big: `${rate}% saved`, line: `That's the share of income left after spending this month so far.`,
        to: '/reports?from=savings', materiality: 50 });
    }
  }

  // ── mirror: biggest category this month ────────────────────────────────────
  const top = Object.entries(spend).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 0) {
    const share = expense > 0 ? Math.round(top[1] / expense * 100) : 0;
    cards.push({ id: `mirror-topcat-${mk}`, type: 'mirror', tone: 'neutral', emoji: getCat(top[0]).icon || '🧾',
      big: `${C(top[1])} on ${getCat(top[0]).label}`, line: `Your biggest category this month${share ? ` — about ${share}% of spending` : ''}.`,
      to: `/transactions?type=expense&cat=${top[0]}&month=${mk}`, materiality: 55 + Math.min(share, 30) });
  }

  // ── win: a category down vs its 3-month average ────────────────────────────
  const prior = prevMonthKeys(transactions, 3);
  if (prior.length) {
    const avg = new Map<string, number>();
    for (const pmk of prior)
      for (const [cat, amt] of Object.entries(spendByCategory(transactions, pmk, baseCurrency, rates)))
        avg.set(cat, (avg.get(cat) || 0) + amt / prior.length);
    let best: { cat: string; drop: number; now: number; was: number } | null = null;
    for (const [cat, was] of avg) {
      const now = spend[cat] || 0;
      if (was <= 0) continue;
      const drop = Math.round((1 - now / was) * 100);
      if (drop >= 15 && (!best || drop > best.drop)) best = { cat, drop, now, was };
    }
    if (best) {
      cards.push({ id: `win-catdown-${best.cat}-${mk}`, type: 'win', tone: 'positive', emoji: '📉',
        big: `${getCat(best.cat).label} down ${best.drop}%`, line: `Versus your 3-month average (${C(best.was)} → ${C(best.now)}). Nice trim.`,
        to: `/transactions?type=expense&cat=${best.cat}&month=${mk}`, materiality: 60 + best.drop });
    }
  }

  // ── forecast: project month-end spend from pace so far ─────────────────────
  if (expense > 0) {
    const now = new Date();
    const day = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (day >= 5 && day < daysInMonth) {
      const projected = Math.round(expense / day * daysInMonth);
      cards.push({ id: `forecast-spend-${mk}`, type: 'forecast', tone: 'neutral', emoji: '🔮',
        big: `≈ ${C(projected)}`, line: `At this pace, your spending lands near ${C(projected)} by month-end.`,
        to: '/reports', materiality: 58 });
    }
  }

  // ── pulse: current score + strongest driver ────────────────────────────────
  const pulse = computePulseScore(transactions, budgets, goals, debts, baseCurrency, rates);
  if (pulse.total !== null) {
    const entries = (Object.entries(pulse.components) as [keyof typeof pulse.components, number][])
      .filter(([k]) => pulse.applicable[k]);
    const strongest = entries.sort((a, b) => b[1] - a[1])[0];
    const labels: Record<string, string> = { budget: 'budget discipline', savings: 'savings rate', trend: 'spending trend', debt: 'debt health' };
    cards.push({ id: `pulse-${mk}`, type: 'pulse', tone: 'neutral', emoji: '🫀',
      big: `Pulse ${pulse.total}`, line: strongest ? `Your strongest area right now is ${labels[strongest[0]] ?? strongest[0]}.` : `Your family finance health score.`,
      to: '/reports', materiality: 48 });
  }

  // ── nudge_to_learn: contextual evergreen surfacing (constructive, capped) ──
  const dti = income > 0 ? (totalMonthlyDebtPayment(debts, baseCurrency, rates) / income) * 100 : 0;
  if (dti > 36) {
    const lesson = evergreenByTag(['dti', 'debt', 'payoff']);
    if (lesson) cards.push({ id: `nudge-dti-${mk}`, type: 'nudge_to_learn', tone: 'constructive', emoji: '📚',
      big: `Debt is ${Math.round(dti)}% of income`, line: `A quick read on bringing that down — ${lesson.title}.`,
      learnId: lesson.id, materiality: 64 });
  } else if (income > 0 && (income - expense) / income < 0.1) {
    const lesson = evergreenByTag(['emergency_fund', 'saving', 'runway']);
    if (lesson) cards.push({ id: `nudge-savings-${mk}`, type: 'nudge_to_learn', tone: 'constructive', emoji: '📚',
      big: `Thin buffer this month`, line: `A 2-minute idea that helps — ${lesson.title}.`,
      learnId: lesson.id, materiality: 56 });
  }

  return rankAndMix(cards, limit);
}

/** Rank by materiality, then enforce the §5 tone mix: at most ONE constructive
 *  card per session; the rest neutral/positive, freshest (most material) first. */
function rankAndMix(cards: FeedCard[], limit: number): FeedCard[] {
  const sorted = [...cards].sort((a, b) => b.materiality - a.materiality || a.id.localeCompare(b.id));
  const out: FeedCard[] = [];
  let constructive = 0;
  for (const c of sorted) {
    if (out.length >= limit) break;
    if (c.tone === 'constructive') {
      if (constructive >= 1) continue;
      constructive++;
    }
    out.push(c);
  }
  return out;
}
