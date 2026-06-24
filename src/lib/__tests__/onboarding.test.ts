import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// CON-UNIT-ONB-001..020 — Onboarding & Activation module.
// See vyact-onboarding-engineering-spec.md (§1–§6) and TEST_SCENARIOS.md.
//
// vitest runs in `node` env, so we install minimal localStorage / sessionStorage
// polyfills for the duration of the file. The onboarding modules read the feature
// flag from config/features.ts (enabled = true in this build).

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
}

const g = globalThis as unknown as {
  localStorage?: MemStorage;
  sessionStorage?: MemStorage;
};

beforeEach(() => {
  g.localStorage = new MemStorage();
  g.sessionStorage = new MemStorage();
});
afterEach(() => {
  delete g.localStorage;
  delete g.sessionStorage;
});

const HID = 'hh_test';
const DAY = 24 * 60 * 60 * 1000;

describe('onboardingState — per-household state machine (spec §2/§3)', () => {
  it('CON-UNIT-ONB-001 · a fresh household starts not_started and shouldOnboard=true', async () => {
    const s = await import('../onboardingState');
    expect(s.getOnboarding(HID).state).toBe('not_started');
    expect(s.shouldOnboard(HID)).toBe(true);
  });

  it('CON-UNIT-ONB-002 · markStarted moves to in_progress and stamps startedAt', async () => {
    const s = await import('../onboardingState');
    s.markStarted(HID, 'household');
    const rec = s.getOnboarding(HID);
    expect(rec.state).toBe('in_progress');
    expect(rec.segment).toBe('household');
    expect(rec.startedAt).toBeTruthy();
  });

  it('CON-UNIT-ONB-003 · markCompleted sets a 21-day confirmation window', async () => {
    const s = await import('../onboardingState');
    const rec = s.markCompleted(HID, 'individual', { primaryConcern: 'spending' });
    expect(rec.state).toBe('completed');
    const span = new Date(rec.confirmationWindowEndsAt!).getTime() - new Date(rec.completedAt!).getTime();
    expect(Math.round(span / DAY)).toBe(21);
  });

  it('CON-UNIT-ONB-004 · a completed household is never re-onboarded', async () => {
    const s = await import('../onboardingState');
    s.markCompleted(HID, 'individual', { primaryConcern: 'spending' });
    s.markStarted(HID); // no-op once completed
    expect(s.getOnboarding(HID).state).toBe('completed');
    expect(s.shouldOnboard(HID)).toBe(false);
  });

  it('CON-UNIT-ONB-005 · migrateExistingHousehold marks skipped and is idempotent', async () => {
    const s = await import('../onboardingState');
    s.migrateExistingHousehold(HID);
    expect(s.getOnboarding(HID).state).toBe('skipped');
    s.markCompleted(HID, 'smb', { primaryConcern: 'runway' });
    s.migrateExistingHousehold(HID); // must NOT clobber the completed record
    expect(s.getOnboarding(HID).state).toBe('completed');
  });

  it('CON-UNIT-ONB-006 · skipped households do not onboard', async () => {
    const s = await import('../onboardingState');
    s.markSkipped(HID, 3);
    expect(s.shouldOnboard(HID)).toBe(false);
  });
});

describe('onboardingState — entity provenance + % confirmed (spec §3.2/§5.4)', () => {
  it('CON-UNIT-ONB-007 · onboardingProvenance / isEstimate classify rows', async () => {
    const s = await import('../onboardingState');
    const est = s.onboardingProvenance();
    expect(est.confidence).toBe('estimated');
    expect(est.source).toBe('onboarding');
    expect(s.isEstimate(est)).toBe(true);
    expect(s.isEstimate({ confidence: 'confirming', source: 'onboarding' })).toBe(true);
    expect(s.isEstimate({ confidence: 'confirmed', source: 'user' })).toBe(false);
    // A legacy/user row with no provenance is first-class, not an estimate.
    expect(s.isEstimate({})).toBe(false);
  });

  it('CON-UNIT-ONB-008 · unconfirmedEstimateCount counts only outstanding onboarding estimates', async () => {
    const s = await import('../onboardingState');
    const records = [
      { confidence: 'estimated', source: 'onboarding' } as const,
      { confidence: 'confirming', source: 'onboarding' } as const,
      { confidence: 'confirmed', source: 'user' } as const,
      {} as Record<string, never>, // bare user row
    ];
    expect(s.unconfirmedEstimateCount(records)).toBe(2);
  });

  it('CON-UNIT-ONB-009 · confirmedPct is null with no baseline, else 0–100', async () => {
    const s = await import('../onboardingState');
    expect(s.confirmedPctFromEntities([])).toBeNull();
    // bare user rows carry no provenance → not part of the onboarding baseline.
    expect(s.confirmedPctFromEntities([{}, {}])).toBeNull();
    const pct = s.confirmedPctFromEntities([
      { confidence: 'estimated', source: 'onboarding' },
      { confidence: 'confirmed', source: 'onboarding' },
    ]);
    expect(pct).toBe(50);
  });

  it('CON-UNIT-ONB-010 · confirmedPct is materiality-weighted', async () => {
    const s = await import('../onboardingState');
    const records = [
      { confidence: 'confirmed', source: 'onboarding', w: 1200 },
      { confidence: 'estimated', source: 'onboarding', w: 9 },
    ];
    const pct = s.confirmedPctFromEntities(
      records as unknown as import('../../types').WithProvenance[],
      r => (r as { w?: number }).w ?? 1,
    )!;
    expect(pct).toBeGreaterThan(95);
  });
});

describe('onboardingNudges — progressive capture (spec §6)', () => {
  async function complete(daysAgo: number) {
    const s = await import('../onboardingState');
    s.markCompleted(HID, 'household', { primaryConcern: 'spending' });
    const rec = s.getOnboarding(HID);
    // back-date completedAt
    s.setOnboarding(HID, { completedAt: new Date(Date.now() - daysAgo * DAY).toISOString() });
    return rec;
  }
  // Default estimate stats: one outstanding estimate, 0% confirmed.
  const WITH_ESTIMATE = { unconfirmedEstimates: 1, confirmedPct: 0 };
  const ALL_CONFIRMED = { unconfirmedEstimates: 0, confirmedPct: 100 };

  it('CON-UNIT-ONB-011 · no nudge before completion', async () => {
    const n = await import('../onboardingNudges');
    expect(n.getActiveNudge({ householdId: HID, logCount: 10, ...WITH_ESTIMATE })).toBeNull();
  });

  it('CON-UNIT-ONB-012 · day-7 check-in fires when <80% confirmed', async () => {
    await complete(7);
    const n = await import('../onboardingNudges');
    const nudge = n.getActiveNudge({ householdId: HID, logCount: 0, ...WITH_ESTIMATE });
    expect(nudge?.kind).toBe('check_in');
  });

  it('CON-UNIT-ONB-013 · rate-limited to one nudge per session', async () => {
    await complete(7);
    const n = await import('../onboardingNudges');
    expect(n.getActiveNudge({ householdId: HID, logCount: 0, ...WITH_ESTIMATE })).not.toBeNull();
    n.markNudgeShownThisSession();
    expect(n.getActiveNudge({ householdId: HID, logCount: 0, ...WITH_ESTIMATE })).toBeNull();
  });

  it('CON-UNIT-ONB-014 · a dismissed nudge does not return; the next candidate falls through', async () => {
    await complete(7);
    const n = await import('../onboardingNudges');
    const first = n.getActiveNudge({ householdId: HID, logCount: 0, ...WITH_ESTIMATE })!;
    expect(first.kind).toBe('check_in');
    n.dismissNudge(first.id);
    // Same id never returns; the next-priority candidate (confirm_estimate) shows.
    const second = n.getActiveNudge({ householdId: HID, logCount: 0, ...WITH_ESTIMATE })!;
    expect(second.id).not.toBe(first.id);
    expect(second.kind).toBe('confirm_estimate');
    n.dismissNudge(second.id);
    expect(n.getActiveNudge({ householdId: HID, logCount: 0, ...WITH_ESTIMATE })).toBeNull();
  });

  it('CON-UNIT-ONB-015 · bank-connect offer requires ≥5 real logs and never repeats', async () => {
    await complete(2); // within window, everything confirmed so check_in/confirm don't pre-empt
    const n = await import('../onboardingNudges');
    expect(n.getActiveNudge({ householdId: HID, logCount: 4, ...ALL_CONFIRMED })).toBeNull(); // below threshold
    const offer = n.getActiveNudge({ householdId: HID, logCount: 5, ...ALL_CONFIRMED });
    expect(offer?.kind).toBe('bank_connect');
    n.markBankConnectOffered(HID);
    expect(n.getActiveNudge({ householdId: HID, logCount: 9, ...ALL_CONFIRMED })).toBeNull(); // once only
  });

  it('CON-UNIT-ONB-016 · active nudging tapers after the 21-day window', async () => {
    await complete(30); // past the window
    const n = await import('../onboardingNudges');
    // No check-in (>21) and confirm-estimate tapers past window → null.
    expect(n.getActiveNudge({ householdId: HID, logCount: 0, ...WITH_ESTIMATE })).toBeNull();
  });
});
