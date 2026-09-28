// Vyact Agent — Claude Code relay helpers (v10.37.0, TEST-ONLY, TD-44).
//
// The relay stands a Claude Code session in for the model during a test cycle. The
// load-bearing property is the ALLOWLIST: a relay row must never route a user who is
// not explicitly listed, and must leave every other config untouched.

import { describe, expect, it } from 'vitest';
import {
  detectCallKind,
  filterRelayRows,
  filterRowsForUser,
  isRelayConfig,
  relayAllows,
  relayPollState,
  rowAppliesToUser,
  RELAY_PROVIDER,
  RELAY_TTL_MS,
} from '../../../../supabase/functions/_shared/agent/relay';
import { CLASSIFY_SYSTEM, PHRASE_SYSTEM } from '../askVyactLlm';

const TESTER = 'c89fe12a-e815-4a78-aa64-d40b2e051fb2';
const relayRow = (allowed?: unknown) => ({ provider: RELAY_PROVIDER, priority: 200,
  params: allowed === undefined ? {} : { allowed_user_ids: allowed } });
const modelRow = { provider: 'openrouter', priority: 110, params: { max_tokens: 600 } };

describe('Claude Code relay — allowlist', () => {
  it('CON-UNIT-RELAY-001 · routes only an explicitly allowlisted user', () => {
    expect(isRelayConfig(relayRow([TESTER]))).toBe(true);
    expect(isRelayConfig(modelRow)).toBe(false);
    expect(relayAllows(relayRow([TESTER]), TESTER)).toBe(true);
    expect(relayAllows(relayRow([TESTER]), 'someone-else')).toBe(false);
  });

  it('CON-UNIT-RELAY-002 · an empty, missing or malformed allowlist routes nobody', () => {
    expect(relayAllows(relayRow([]), TESTER)).toBe(false);
    expect(relayAllows(relayRow(), TESTER)).toBe(false);
    expect(relayAllows(relayRow(TESTER), TESTER)).toBe(false);
    expect(relayAllows(relayRow([TESTER]), '')).toBe(false);
  });

  it('CON-UNIT-RELAY-003 · filtering drops the relay for others and keeps every non-relay row', () => {
    const rows = [relayRow([TESTER]), modelRow];
    expect(filterRelayRows(rows, TESTER)).toEqual(rows);
    expect(filterRelayRows(rows, 'someone-else')).toEqual([modelRow]);
  });
});

// v10.38 — the same allowlist pilots ANY provider on one account (a self-hosted
// model, say) before it is promoted to the household.
describe('per-account model pilot (v10.38)', () => {
  const piloted = { provider: 'lmstudio', priority: 200, params: { allowed_user_ids: [TESTER] } };
  const shared = { provider: 'openrouter', priority: 110, params: { max_tokens: 600 } };

  it('CON-UNIT-RELAY-006 · an allowlisted row serves only those users; everyone else falls through', () => {
    expect(rowAppliesToUser(piloted, TESTER)).toBe(true);
    expect(rowAppliesToUser(piloted, 'someone-else')).toBe(false);
    expect(filterRowsForUser([piloted, shared], TESTER)).toEqual([piloted, shared]);
    expect(filterRowsForUser([piloted, shared], 'someone-else')).toEqual([shared]);
  });

  it('CON-UNIT-RELAY-007 · a row with NO allowlist serves everyone — adding the key to nothing changes nothing', () => {
    expect(rowAppliesToUser(shared, TESTER)).toBe(true);
    expect(rowAppliesToUser(shared, 'anyone')).toBe(true);
    expect(rowAppliesToUser({ provider: 'openrouter', params: null }, 'anyone')).toBe(true);
    // Promotion = removing the key. The same row then applies to every caller.
    const promoted = { ...piloted, params: {} };
    expect(rowAppliesToUser(promoted, 'someone-else')).toBe(true);
  });

  it('CON-UNIT-RELAY-008 · a relay row still REQUIRES its allowlist, empty or missing means nobody', () => {
    expect(rowAppliesToUser(relayRow([]), TESTER)).toBe(false);
    expect(rowAppliesToUser(relayRow(), TESTER)).toBe(false);
    expect(rowAppliesToUser(relayRow([TESTER]), TESTER)).toBe(true);
  });
});

describe('Claude Code relay — call labelling and polling', () => {
  it('CON-UNIT-RELAY-004 · labels the real classify and phrase prompts correctly', () => {
    expect(detectCallKind([{ role: 'system', content: CLASSIFY_SYSTEM }, { role: 'user', content: 'q' }])).toBe('classify');
    expect(detectCallKind([{ role: 'system', content: PHRASE_SYSTEM }, { role: 'user', content: '{}' }])).toBe('phrase');
    expect(detectCallKind([{ role: 'user', content: 'no system prompt' }])).toBe('other');
  });

  it('CON-UNIT-RELAY-005 · a poll is pending, answered with latency, or expired after the TTL', () => {
    const created = '2026-09-15T10:00:00.000Z';
    const t0 = Date.parse(created);
    expect(relayPollState({ status: 'pending', created_at: created }, t0 + 1000)).toEqual({ state: 'pending' });
    expect(relayPollState({ status: 'answered', created_at: created, answered_at: '2026-09-15T10:00:12.000Z', response: 'Hi' }, t0 + 60_000))
      .toEqual({ state: 'answered', text: 'Hi', latencyMs: 12_000 });
    expect(relayPollState({ status: 'pending', created_at: created }, t0 + RELAY_TTL_MS + 1)).toEqual({ state: 'expired' });
    expect(relayPollState({ status: 'expired', created_at: created }, t0)).toEqual({ state: 'expired' });
  });
});
