// v10.54.0 — Pip answer feedback (👍 / 👎). Pinned: the stored row is the rating,
// the classified intent, the answer's LENGTH and the surface — never the question
// or the answer text (the ai_usage privacy rule); and a local-only household
// writes nothing.
import { describe, expect, it } from 'vitest';
import { feedbackRow, saveFeedback } from '../aiFeedback';

const QUESTION = 'How much did I spend on groceries at FreshMart last month?';
const ANSWER = 'You spent $412 on groceries last month.';

describe('Pip answer feedback', () => {
  it('CON-UNIT-FDB-001 · the row carries no question or answer text', () => {
    const row = feedbackRow({ householdId: 'h1', turnId: 'turn-1', rating: 1, question: QUESTION, answerLength: ANSWER.length });
    expect(Object.keys(row).sort()).toEqual(['household_id', 'intent', 'rating', 'response_len', 'surface', 'turn_id']);
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain('FreshMart');
    expect(serialised).not.toContain('groceries at');
    expect(serialised).not.toContain('$412');
    expect(row).toMatchObject({ household_id: 'h1', turn_id: 'turn-1', rating: 1, response_len: ANSWER.length, surface: 'app' });
    expect(typeof row.intent).toBe('string');
  });

  it('CON-UNIT-FDB-002 · bounds match the table constraints', () => {
    const row = feedbackRow({ householdId: 'h1', turnId: 'x'.repeat(100), rating: -1, question: '', answerLength: -3.6 });
    expect(row.turn_id).toHaveLength(64);
    expect(row.response_len).toBe(0);
    expect(row.rating).toBe(-1);
    expect(row.intent.length).toBeLessThanOrEqual(64);
  });

  it('CON-UNIT-FDB-003 · local-only mode is a silent no-op', async () => {
    await expect(saveFeedback({ householdId: 'local', turnId: 'turn-1', rating: 1, question: QUESTION, answerLength: 10 }))
      .resolves.toBeUndefined();
  });
});
