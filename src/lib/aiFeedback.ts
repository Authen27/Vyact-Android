// Pip answer feedback (v10.54.0) — the 👍 / 👎 under each answer, stored for the
// admin console (table ai_feedback, migration 20261005120000) and sent to GA.
//
// PRIVACY: never the question or the answer. A row is the rating, the classified
// intent of the question it answered, the answer's length and the surface — the
// same rule as ai_usage. One rating per answer per person: rating again replaces it,
// taking it back (rating null) deletes it.
import { isCloudEnabled, supabase } from './supabase';
import { classifyIntent } from './aiUsage';

export type FeedbackRating = 1 | -1;

export interface FeedbackInput {
  householdId: string;
  turnId: string;
  rating: FeedbackRating | null;
  question: string;      // used only to classify the intent; never stored
  answerLength: number;
}

/** The row that would be stored — pure, so the privacy rule is testable. */
export function feedbackRow(input: FeedbackInput & { rating: FeedbackRating }) {
  return {
    household_id: input.householdId,
    turn_id: input.turnId.slice(0, 64),
    rating: input.rating,
    intent: classifyIntent(input.question).slice(0, 64),
    response_len: Math.max(0, Math.round(input.answerLength)),
    surface: 'app' as const,
  };
}

/** Save (or clear) a rating. Cloud households only; failures never reach the person. */
export async function saveFeedback(input: FeedbackInput): Promise<void> {
  if (!isCloudEnabled() || !supabase) return;
  if (!input.householdId || input.householdId === 'local' || !input.turnId) return;
  try {
    if (input.rating === null) {
      await supabase.from('ai_feedback').delete().eq('turn_id', input.turnId.slice(0, 64));
      return;
    }
    await supabase.from('ai_feedback')
      .upsert({ ...feedbackRow({ ...input, rating: input.rating }), updated_at: new Date().toISOString() },
        { onConflict: 'user_id,turn_id' });
  } catch { /* feedback is best-effort */ }
}
