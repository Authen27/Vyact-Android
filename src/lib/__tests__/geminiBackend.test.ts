import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiChatBackend } from '../geminiBackend';
import type { SafeSummary } from '../aiSummary';

// CON-UNIT-060 / 061 / 062 — TD-07 Gemini backend pins.
//
// fetch is stubbed so no live HTTP. The shape of the request body and
// the decoding of the response are the contract worth pinning; the
// transport itself (browser fetch) is not interesting.

const SUMMARY: SafeSummary = {
  asOf: '2026-06-01',
  baseCurrency: 'USD',
  household: { type: 'family', members: 2 },
  pulseScore: { total: 72, components: { budget: 18, savings: 16, goals: 12, trend: 12, debt: 14 } },
  thisMonth: { monthKey: '2026-06', income: 8000, expense: 6000, netSavingsRate: 0.25, topCategories: [] },
  trend6m: [],
  netWorth: { totalAssets: 100000, totalLiabilities: 30000, netWorth: 70000, liquidityMonths: 4, debtToAssetPct: 30 },
  budgets: [], goals: [], debts: [],
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('TD-07 GeminiChatBackend (CON-UNIT-060)', () => {
  it('posts a single user turn containing the SafeSummary JSON + question', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'You spent $6,000 this month.' }] } }] }),
    });

    const be = new GeminiChatBackend('test-key', 'gemini-1.5-flash');
    const answer = await be.ask('How much did I spend?', SUMMARY, []);
    expect(answer).toBe('You spent $6,000 this month.');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain('gemini-1.5-flash');
    expect(url).not.toContain('key=');

    const init = call[1] as { method: string; body: string; headers: Record<string, string> };
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toMatch(/Vyact's family-finance coach/);
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toContain('How much did I spend?');
    expect(body.contents[0].parts[0].text).toContain('"baseCurrency":"USD"');
  });

  it('threads prior conversation turns with correct user/model role mapping', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK.' }] } }] }),
    });

    const be = new GeminiChatBackend('test-key', 'gemini-1.5-flash');
    await be.ask('next?', SUMMARY, [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
  });
});

describe('TD-07 GeminiChatBackend error surfacing (CON-UNIT-061)', () => {
  it('surfaces the API error message on a non-OK response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'API key not valid' } }),
    });

    const be = new GeminiChatBackend('bad-key');
    await expect(be.ask('q', SUMMARY, [])).rejects.toThrow(/API key not valid/);
  });

  it('throws when the prompt is blocked by safety filters', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    });

    const be = new GeminiChatBackend('test-key');
    await expect(be.ask('q', SUMMARY, [])).rejects.toThrow(/blocked/i);
  });

  it('throws when the response has no text', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS' }] }),
    });

    const be = new GeminiChatBackend('test-key');
    await expect(be.ask('q', SUMMARY, [])).rejects.toThrow(/MAX_TOKENS|no text/i);
  });
});

describe('TD-07 backend construction (CON-UNIT-062)', () => {
  it('rejects empty API key', () => {
    expect(() => new GeminiChatBackend('')).toThrow();
  });

  it('reports isReal() === true', () => {
    expect(new GeminiChatBackend('x').isReal()).toBe(true);
  });
});
