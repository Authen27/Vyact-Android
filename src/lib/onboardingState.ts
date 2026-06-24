// Vyact — Onboarding per-household state (spec §2, §3, §5).
//
// Two halves, two storage strategies (v8.0.1 cloud-sync revision):
//
//  1. The per-household STATE MACHINE record (this file). Persisted to the cloud
//     on `households.onboarding` (jsonb) so it follows the household across
//     devices, with a synchronous localStorage cache so the sync read API the UI
//     relies on keeps working offline / before the first cloud round-trip.
//
//  2. RECORD PROVENANCE (confidence + source) now lives as real columns ON each
//     baseline-derived entity row (Budget / Goal / Debt / Transaction / Asset) —
//     see types.ts `WithProvenance`. It therefore rides the existing entity sync
//     machinery for free (multi-device + survives a cache clear). The helpers at
//     the bottom of this file operate over those entities; there is no longer a
//     separate provenance overlay.

import { FEATURES, isOnboardingEnabled } from '../config/features';
import type { Confidence, ProvenanceSource, WithProvenance } from '../types';

export type { Confidence, ProvenanceSource } from '../types';
/** @deprecated use ProvenanceSource */
export type Source = ProvenanceSource;

// ── Types ───────────────────────────────────────────────────────────────────

export type OnboardingFlowState =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'skipped';

export type Segment = 'individual' | 'household' | 'smb';

export interface OnboardingContext {
  primaryConcern: string;
  adultCount?: 1 | 2 | 3;        // 3 = "more"
  dependents?: 'none' | 'kids' | 'other';
  splitRatio?: number | null;
  incomeType?: 'steady' | 'variable';
  businessType?: 'solo' | 'team' | 'side_business';
  taxReservePct?: number | null;
}

export interface HouseholdOnboarding {
  state: OnboardingFlowState;
  segment: Segment | null;
  context: OnboardingContext | null;
  currentStep: number;                      // 0–5, for resume
  startedAt: string | null;                 // ISO
  completedAt: string | null;               // ISO
  confirmationWindowEndsAt: string | null;  // completedAt + 21 days
}

// ── Cloud write-through ───────────────────────────────────────────────────────
//
// onboardingState is a plain module (no store import → no cycle). The store
// registers a persister at startup; every local mutation fires it so the cloud
// `households.onboarding` column stays in step. In local-only mode the store
// registers a no-op and the localStorage cache below IS the durable store.

type CloudPersister = (householdId: string, record: HouseholdOnboarding) => void;
let cloudPersister: CloudPersister | null = null;

export function registerOnboardingSync(fn: CloudPersister | null): void {
  cloudPersister = fn;
}

/** Called by the store after `listHouseholds()` to seed the local cache from the
 *  authoritative cloud value, so the synchronous read API reflects other devices. */
export function hydrateOnboardingFromCloud(
  householdId: string,
  record: Partial<HouseholdOnboarding> | null | undefined,
): void {
  if (!record || typeof record !== 'object' || Object.keys(record).length === 0) return;
  writeJson(STATE_PREFIX + householdId, { ...emptyRecord(), ...record });
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STATE_PREFIX = 'vt_onboarding_'; // + householdId → HouseholdOnboarding (cache)

function emptyRecord(): HouseholdOnboarding {
  return {
    state: 'not_started', segment: null, context: null, currentStep: 0,
    startedAt: null, completedAt: null, confirmationWindowEndsAt: null,
  };
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota — ignore */ }
}

// ── Onboarding state ──────────────────────────────────────────────────────────

export function getOnboarding(householdId: string): HouseholdOnboarding {
  if (!isOnboardingEnabled()) return { ...emptyRecord(), state: 'skipped' };
  return readJson<HouseholdOnboarding>(STATE_PREFIX + householdId, emptyRecord());
}

/** Write the record to the local cache AND push to the cloud (when a persister is
 *  registered). The cloud write is fire-and-forget; the cache is the read source. */
export function setOnboarding(
  householdId: string,
  patch: Partial<HouseholdOnboarding>,
): HouseholdOnboarding {
  const next = { ...getOnboarding(householdId), ...patch };
  writeJson(STATE_PREFIX + householdId, next);
  try { cloudPersister?.(householdId, next); } catch { /* never break the UI */ }
  return next;
}

export function shouldOnboard(householdId: string): boolean {
  if (!isOnboardingEnabled()) return false;
  const rec = getOnboarding(householdId);
  return rec.state === 'not_started' || rec.state === 'in_progress';
}

export function markStarted(householdId: string, segment: Segment | null = null): void {
  const rec = getOnboarding(householdId);
  if (rec.state === 'completed') return; // never re-onboard
  setOnboarding(householdId, {
    state: 'in_progress',
    segment: segment ?? rec.segment,
    startedAt: rec.startedAt ?? new Date().toISOString(),
  });
}

export function markSkipped(householdId: string, fromStep: number): void {
  setOnboarding(householdId, { state: 'skipped', currentStep: fromStep });
}

export function markCompleted(
  householdId: string,
  segment: Segment,
  context: OnboardingContext,
): HouseholdOnboarding {
  const completedAt = new Date().toISOString();
  const ends = new Date(
    Date.now() + FEATURES.onboarding.confirmationWindowDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  return setOnboarding(householdId, {
    state: 'completed', segment, context, currentStep: 5,
    completedAt, confirmationWindowEndsAt: ends,
  });
}

/** Existing pre-feature households are migrated to `skipped` (spec §3.4).
 *  Idempotent — only writes if no record exists yet. */
export function migrateExistingHousehold(householdId: string): void {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(STATE_PREFIX + householdId) != null) return;
  setOnboarding(householdId, { state: 'skipped' });
}

// ── Provenance helpers (operate over entity rows, spec §3.2 / §5.4) ─────────────

/** A record is "an estimate" while it is anything other than confirmed.
 *  Absent confidence means a legacy/user row → treated as confirmed. */
export function isEstimate(rec: WithProvenance): boolean {
  return rec.confidence === 'estimated' || rec.confidence === 'confirming';
}

/** Provenance applied to a record created during onboarding. */
export function onboardingProvenance(at = new Date().toISOString()): WithProvenance {
  return { confidence: 'estimated', source: 'onboarding', estimatedAt: at };
}

/** Materiality-weighted "% confirmed" over the baseline-derived records (spec §5.4).
 *  `materiality(rec)` supplies the weight (e.g. monthly amount); equal-weighted by
 *  default. Returns 0–100, or null when there is no baseline. */
export function confirmedPctFromEntities(
  records: WithProvenance[],
  materiality?: (rec: WithProvenance) => number,
): number | null {
  // Only records that ever carried provenance count toward the baseline.
  const baseline = records.filter(r => r.source === 'onboarding' || r.confidence != null);
  if (baseline.length === 0) return null;
  let total = 0;
  let confirmed = 0;
  for (const r of baseline) {
    const w = Math.max(materiality?.(r) ?? 1, 0.0001);
    total += w;
    if (r.confidence === 'confirmed' || r.confidence == null) confirmed += w;
  }
  return total === 0 ? null : Math.round((confirmed / total) * 100);
}

/** Count of still-unconfirmed onboarding estimates across the given records. */
export function unconfirmedEstimateCount(records: WithProvenance[]): number {
  return records.filter(r => r.source === 'onboarding' && isEstimate(r)).length;
}
