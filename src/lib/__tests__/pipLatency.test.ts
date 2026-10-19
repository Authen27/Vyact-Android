// v10.106.3 — Pip answers faster, and a slow one can be traced. The app's ai_usage row splits the turn
// into stages (classify and phrase round trips, before / between / after), as numbers only; the
// gateway side (lookups together, cached config) is pinned in gatewayWorkflow / agentRouter.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ insert: vi.fn(), cloud: true }));
vi.mock('../supabase', () => ({
  supabase: { from: () => ({ insert: db.insert }) },
  isCloudEnabled: () => db.cloud,
}));

import { createTurnTimer, logAiUsage } from '../aiUsage';

const QUESTION = 'How much did I spend at FreshMart last month?';

/** A clock the test moves by hand. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

beforeEach(() => {
  db.insert.mockReset();
  db.insert.mockResolvedValue({ error: null });
  db.cloud = true;
});

describe('Pip turn timings (v10.106.3)', () => {
  it('PIP-LAT-010 · a turn is split into before, classify, between, phrase (with its retry) and after', async () => {
    const c = clock(1000);
    const timer = createTurnTimer(c.now);
    const call = timer.wrap(async (req: { op: string; user: string }) => {
      c.advance(req.op === 'classify' ? 1400 : 1600);
      return 'ok';
    });
    c.advance(20);                                   // quick-reply check, backend selection
    await call({ op: 'classify', user: QUESTION });
    c.advance(35);                                   // resolve
    await call({ op: 'phrase', user: '{"facts":{}}' });
    c.advance(5);                                    // the guard rejected a figure: retry
    await call({ op: 'phrase', user: '{"facts":{}}' });
    c.advance(9200);                                 // whatever happened after the last reply
    expect(timer.stages()).toEqual({
      total: 20 + 1400 + 35 + 1600 + 5 + 1600 + 9200,
      before: 20, classify: 1400, classifyCalls: 1, between: 35, phrase: 3200, phraseCalls: 2, after: 9200,
    });
  });

  it('PIP-LAT-011 · no model call leaves only the total; a failed call is counted and still timed', async () => {
    const c = clock();
    const quiet = createTurnTimer(c.now);
    c.advance(12);
    expect(quiet.stages()).toEqual({ total: 12 });

    const timer = createTurnTimer(c.now);
    const call = timer.wrap(async () => { c.advance(30_000); throw new Error('The answer took too long'); });
    await expect(call({ op: 'classify' })).rejects.toThrow('too long');
    expect(timer.stages()).toEqual({ total: 30_000, before: 0, classify: 30_000, classifyCalls: 1, after: 0, failedCalls: 1 });
  });

  it('PIP-LAT-012 · the row stores the stages beside the total and never the question', async () => {
    await logAiUsage({ householdId: 'h1', text: QUESTION, latencyMs: 4200,
      stageMs: { total: 4200, classify: 1500, phrase: 2600, phraseCalls: 1 } });
    const row = db.insert.mock.calls[0][0];
    expect(row).toMatchObject({ latency_ms: 4200, stage_ms: { total: 4200, classify: 1500, phrase: 2600, phraseCalls: 1 } });
    expect(JSON.stringify(row)).not.toContain('FreshMart');
  });

  it('PIP-LAT-013 · only what the database accepts is sent: finite numbers under short letter keys', async () => {
    await logAiUsage({ householdId: 'h1', text: 'q', stageMs: {
      total: 10, 'how much on food': 1, phrase: Number.NaN, classify: Infinity, after: 3, classifyCalls: 1,
      ...({ note: 'text' } as unknown as Record<string, number>),
    } });
    expect(db.insert.mock.calls[0][0].stage_ms).toEqual({ total: 10, after: 3, classifyCalls: 1 });
  });

  it('PIP-LAT-014 · a database without the column yet still gets the row, without the timings', async () => {
    db.insert.mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'stage_ms' column of 'ai_usage' in the schema cache" } });
    await logAiUsage({ householdId: 'h1', text: 'q', latencyMs: 900, stageMs: { total: 900, phraseCalls: 1 } });
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.insert.mock.calls[1][0]).not.toHaveProperty('stage_ms');
    expect(db.insert.mock.calls[1][0]).toMatchObject({ latency_ms: 900 });
  });

  it('PIP-LAT-015 · local-only mode writes nothing', async () => {
    db.cloud = false;
    await logAiUsage({ householdId: 'h1', text: 'q', stageMs: { total: 1, classifyCalls: 1 } });
    await logAiUsage({ householdId: 'local', text: 'q', stageMs: { total: 1, classifyCalls: 1 } });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('T5C-001 · only a turn that called the model writes a row (FE-PIP-09: the gateway meters every call)', async () => {
    await logAiUsage({ householdId: 'h1', text: 'q' });                                   // no timings
    await logAiUsage({ householdId: 'h1', text: 'q', stageMs: { total: 40 } });           // a quick reply / greeting
    await logAiUsage({ householdId: 'h1', text: 'q', outcome: 'error', stageMs: { total: 5 } });   // failed before any call
    expect(db.insert).not.toHaveBeenCalled();
    await logAiUsage({ householdId: 'h1', text: 'q', outcome: 'error',
      stageMs: { total: 30_000, before: 0, classify: 30_000, classifyCalls: 1, after: 0, failedCalls: 1 } });
    await logAiUsage({ householdId: 'h1', text: 'q', stageMs: { total: 900, phrase: 800, phraseCalls: 1 } });
    expect(db.insert).toHaveBeenCalledTimes(2);
    const chat = readFileSync(resolve(__dirname, '../../pages/Chat.tsx'), 'utf8');
    expect(chat.match(/logAiUsage\(\{/g)).toHaveLength(2);   // the answered turn and the failed one; the off path writes none
  });

  it('PIP-LAT-016 · the chat times every model call of the turn and logs the stages with each outcome', () => {
    const chat = readFileSync(resolve(__dirname, '../../pages/Chat.tsx'), 'utf8');
    expect(chat).toMatch(/new LlmBackend\(timer\.wrap\(modelCall\)\)/);
    expect(chat.match(/stageMs: timer\.stages\(\)/g)).toHaveLength(2);   // the answered turn and the failed one
  });
});
