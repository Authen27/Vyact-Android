// Vyact v6.4.6 — AI usage metrics (intent + sentiment).
//
// Privacy-first: we NEVER persist the user's message text. We derive a coarse
// intent and emotional sentiment locally and log only those signals plus the
// message length. This lets the business segment user types (via the admin app)
// without storing any conversation content.

import { supabase, isCloudEnabled } from './supabase';

export type Intent =
  | 'spending' | 'savings' | 'budget' | 'debt' | 'networth'
  | 'goals' | 'pulse' | 'planning' | 'help' | 'other';

export type Sentiment = 'positive' | 'neutral' | 'negative';

const INTENT_PATTERNS: [Intent, RegExp][] = [
  ['spending',  /\b(spend|spent|spending|expense|expenses|cost|costs|paid|purchase|bought)\b/i],
  ['savings',   /\b(save|saving|savings|set aside|emergency fund|rainy day)\b/i],
  ['budget',    /\b(budget|budgets|limit|over\s?spend|category cap|allowance)\b/i],
  ['debt',      /\b(debt|debts|loan|owe|emi|mortgage|credit card|payoff|interest|apr|avalanche|snowball)\b/i],
  ['networth',  /\b(net worth|networth|wealth|asset|assets|liabilit|balance sheet|portfolio)\b/i],
  ['goals',     /\b(goal|goals|target|milestone|vacation|down ?payment|retire)\b/i],
  ['pulse',     /\b(pulse|score|financial health|how am i doing|am i okay)\b/i],
  ['planning',  /\b(plan|planner|recommend|advice|should i|how can i|optimi[sz]e|strategy)\b/i],
  ['help',      /\b(help|how do i|how to|what can you|guide|explain|tutorial)\b/i],
];

export function classifyIntent(text: string): Intent {
  for (const [intent, re] of INTENT_PATTERNS) if (re.test(text)) return intent;
  return 'other';
}

// Emotional tone only — deliberately excludes topic words (e.g. "debt") so a
// neutral question about debt is not mis-scored as negative.
const POSITIVE = /\b(great|good|happy|love|awesome|nice|thanks|thank you|excellent|progress|win|wins|excited|relieved|confident|glad|proud|on track)\b/i;
const NEGATIVE = /\b(worried|worry|worrying|stress|stressed|anxious|anxiety|confused|confusing|frustrat\w*|angry|hate|terrible|awful|scared|afraid|overwhelm\w*|struggl\w*|stuck|panic|hopeless|desperate|behind|drowning|broke|can'?t cope)\b/i;

export function analyzeSentiment(text: string): { sentiment: Sentiment; score: number } {
  const pos = (text.match(new RegExp(POSITIVE, 'gi')) || []).length;
  const neg = (text.match(new RegExp(NEGATIVE, 'gi')) || []).length;
  if (pos === 0 && neg === 0) return { sentiment: 'neutral', score: 0 };
  const score = Math.max(-1, Math.min(1, (pos - neg) / (pos + neg)));
  const sentiment: Sentiment = score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral';
  return { sentiment, score: Number(score.toFixed(2)) };
}

// AI-P0 — engine/cost telemetry. These feed the spec §8/§10 LLM-spend gate
// (fallback rate, thumbs-up rate, deterministic hit rate, tokens, cost, latency)
// surfaced by `admin_ai_usage_summary()` on the admin Intelligence page.
// STILL NO MESSAGE CONTENT — these are all metadata about the call.
export interface AiUsageTelemetry {
  /** Which engine answered. Every 'rules' row is an LLM call we did NOT pay for. */
  backend?: 'rules' | 'llm';
  /** t0 = rules fast-path · t1 = single agent + tools · t2 = supervisor. */
  tier?: 't0' | 't1' | 't2';
  provider?: string;            // 'openrouter' | 'groq' | 'vllm' | …
  model?: string;               // e.g. 'llama-3.3-70b-instruct'
  promptTokens?: number;
  completionTokens?: number;
  /** Computed server-side from tokens × the model rate; a client value is advisory only. */
  costUsd?: number;
  latencyMs?: number;
  outcome?: 'ok' | 'error' | 'blocked' | 'fallback' | 'clarify';
  toolCalls?: number;
  /** §10 gate: thumbs up/down. Leave undefined until the user actually rates. */
  helpful?: boolean;
  tapDepth?: number;
}

/**
 * Log one AI interaction. Fire-and-forget; never throws into the caller.
 * Stores intent + sentiment + length + call metadata only — NEVER message text.
 */
export async function logAiUsage(opts: {
  householdId: string;
  text: string;
  surface?: string;
} & AiUsageTelemetry): Promise<void> {
  if (!isCloudEnabled() || !supabase) return;
  if (!opts.householdId || opts.householdId === 'local') return;
  try {
    const intent = classifyIntent(opts.text);
    const { sentiment, score } = analyzeSentiment(opts.text);
    await supabase.from('ai_usage').insert({
      household_id: opts.householdId,
      surface: opts.surface ?? 'chat',
      intent,
      sentiment,
      sentiment_score: score,
      message_len: opts.text.length,
      // ── AI-P0 telemetry (all nullable; omitted keys stay null) ──
      backend: opts.backend ?? null,
      tier: opts.tier ?? null,
      provider: opts.provider ?? null,
      model: opts.model ?? null,
      prompt_tokens: opts.promptTokens ?? null,
      completion_tokens: opts.completionTokens ?? null,
      cost_usd: opts.costUsd ?? null,
      latency_ms: opts.latencyMs ?? null,
      outcome: opts.outcome ?? null,
      tool_calls: opts.toolCalls ?? null,
      helpful: opts.helpful ?? null,
      tap_depth: opts.tapDepth ?? null,
      // user_id defaults to auth.uid() on the server.
    });
  } catch {
    // Metrics are best-effort; never disrupt the chat experience.
  }
}
