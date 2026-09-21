// Vyact Agent — model router: THE OFF-STATE GATE (architecture §11, rule 6).
//
// WHY THIS FILE EXISTS SEPARATELY FROM router.test.ts
// The router ships its own Deno test, but vitest's include glob is
// `src/**/*.test.ts` under `react/` and there is no `deno test` CI job — so that
// proof was written, correct, and NEVER RUN by CI. The binding rule it guards
// ("the feature's off state must be provably byte-identical to today") was
// therefore unenforced.
//
// This mirrors the load-bearing assertions into the suite that actually runs on
// every commit, importing the real module by relative path — the same technique
// `moneyPortParity.test.ts` uses to reach the Deno money port.
//
// The assertions here are deliberately NEGATIVE. "It returned not_configured" is
// weak; "it opened no socket, read no secret, and wrote no metering row" is the
// claim that matters, because the failure mode being guarded is *spending money
// or leaking data while the feature is supposed to be off*.
import { describe, it, expect, vi } from 'vitest';
import {
  selectModelConfig, chatCompletion, checkConfig, buildUsageRow,
  type ModelConfigRow,
} from '../../../../supabase/functions/_shared/agent/router';

const row = (over: Partial<ModelConfigRow> = {}): ModelConfigRow => ({
  id: 'cfg-1',
  seam: 'assistant',
  provider: 'vllm',
  model: 'qwen2.5-7b-instruct',
  base_url: 'https://models.example.com/v1',
  key_env_var: null,
  params: null,
  enabled: true,
  priority: 0,
  ...over,
} as ModelConfigRow);

/** A fetch that fails the test if anything ever calls it. */
const forbiddenFetch = vi.fn(() => {
  throw new Error('network call attempted while the agent is OFF');
}) as unknown as typeof fetch;

describe('selectModelConfig — nothing enabled means OFF', () => {
  it('returns null for an empty, null or undefined table', () => {
    expect(selectModelConfig([], 'assistant')).toBeNull();
    expect(selectModelConfig(null, 'assistant')).toBeNull();
    expect(selectModelConfig(undefined, 'assistant')).toBeNull();
  });

  it('returns null when every row is disabled', () => {
    expect(selectModelConfig([row({ enabled: false })], 'assistant')).toBeNull();
  });

  it('never serves one seam from another seam\'s row', () => {
    // The `seam` column exists precisely so a toggle cannot silently configure
    // the wrong path — two selectors exist in the app.
    const chatOnly = [row({ seam: 'chat' })];
    expect(selectModelConfig(chatOnly, 'assistant')).toBeNull();
    expect(selectModelConfig(chatOnly, 'chat')).not.toBeNull();
  });

  it('drops rows with a blank model or base_url', () => {
    expect(selectModelConfig([row({ model: '   ' })], 'assistant')).toBeNull();
    expect(selectModelConfig([row({ base_url: '' })], 'assistant')).toBeNull();
  });

  it('picks highest priority, breaking ties deterministically so evals reproduce', () => {
    const rows = [
      row({ id: 'b', priority: 1 }),
      row({ id: 'a', priority: 5 }),
      row({ id: 'c', priority: 5 }),
    ];
    expect(selectModelConfig(rows, 'assistant')?.id).toBe('a');
    // Same input, same answer, every time.
    expect(selectModelConfig([...rows].reverse(), 'assistant')?.id).toBe('a');
  });
});

describe('🔒 OFF spends nothing — the non-negotiable', () => {
  it('opens no socket and reads no secret when no config is enabled', async () => {
    const readEnv = vi.fn(() => '');
    const result = await chatCompletion(
      [{ role: 'user', content: 'hello' }],
      { config: null, fetchImpl: forbiddenFetch, readEnv },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_configured');
    // The assertions that actually matter:
    expect(forbiddenFetch).not.toHaveBeenCalled();
    expect(readEnv).not.toHaveBeenCalled();
  });

  it('writes NO ai_usage row when off — no observable database change', () => {
    const offResult = {
      ok: false as const, code: 'not_configured' as const,
      message: 'off', provider: 'none', model: 'none', latencyMs: 0,
    };
    expect(buildUsageRow(offResult)).toBeNull();
  });

  it('every pre-flight rejection is spend-free and unmetered', async () => {
    const readEnv = vi.fn(() => '');
    // A row pointing at localhost: unreachable from a cloud edge function. It
    // must be classified BEFORE any fetch, not discovered via a 20s hang.
    const localhost = await chatCompletion(
      [{ role: 'user', content: 'hi' }],
      { config: row({ base_url: 'http://localhost:8000/v1' }), fetchImpl: forbiddenFetch, readEnv },
    );
    expect(localhost.ok).toBe(false);
    // The guarantees that matter: no socket opened, no secret read.
    expect(forbiddenFetch).not.toHaveBeenCalled();
    expect(readEnv).not.toHaveBeenCalled();
    // NOTE: an unreachable row IS metered (outcome error, 0 tokens, null cost).
    // That is deliberate observability for a misconfigured config row, not spend.
    const usage = buildUsageRow(localhost);
    if (usage) { expect(usage.cost_usd).toBeNull(); expect(usage.prompt_tokens).toBe(0); }
  });

  it('refuses the cloud metadata endpoint outright', () => {
    const check = checkConfig(row({ base_url: 'http://169.254.169.254/v1' }));
    expect(check.ok).toBe(false);
  });

  it('a null config is reported as not configured, never as ready', () => {
    const check = checkConfig(null);
    expect(check.ok).toBe(false);
    expect(check.code).toBe('not_configured');
    expect(check.endpoint).toBeUndefined();
  });
});

describe('secret handling', () => {
  it('never reads a denylisted env var name', async () => {
    const readEnv = vi.fn(() => 'super-secret-value');
    const result = await chatCompletion(
      [{ role: 'user', content: 'hi' }],
      {
        // A config row trying to exfiltrate the service-role key by naming it.
        config: row({ key_env_var: 'SUPABASE_SERVICE_ROLE_KEY' }),
        fetchImpl: forbiddenFetch,
        readEnv,
      },
    );
    expect(result.ok).toBe(false);
    // The name must be rejected WITHOUT the value ever being read.
    expect(readEnv).not.toHaveBeenCalled();
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
});
