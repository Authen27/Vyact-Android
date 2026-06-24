// Vyact — Progressive-capture nudges (spec §6).
//
// Onboarding captures the minimum; the rest accretes in context through gentle,
// skippable nudges. This module is the pure decision layer: given the household's
// onboarding state, its estimate provenance, and activity counts, it returns the
// single highest-priority nudge that should show right now — or null.
//
// Governance (spec §6.3):
//   • Non-blocking + dismissible (dismissals persist per nudge id).
//   • Rate-limited to max ONE capture nudge per session.
//   • Nothing fires when FEATURES.onboarding.enabled is false.
//   • Active nudging tapers after the 21-day window (no nagging forever, §5.3).

import { FEATURES, isOnboardingEnabled } from '../config/features';
import { getOnboarding } from './onboardingState';

export type NudgeKind = 'check_in' | 'confirm_estimate' | 'bank_connect';

export interface Nudge {
  /** Stable id — also the dismissal key. */
  id: string;
  kind: NudgeKind;
  title: string;
  body: string;
  cta: string;
  /** Where the CTA should take the user. */
  href: string;
}

export interface NudgeInputs {
  householdId: string;
  /** Count of real (user/bank) transactions logged. */
  logCount: number;
  /** Outstanding onboarding estimates not yet confirmed (from entity rows). */
  unconfirmedEstimates: number;
  /** Materiality-weighted % confirmed over the baseline, or null if no baseline. */
  confirmedPct: number | null;
  /** Now, injectable for tests. */
  now?: number;
}

const DISMISS_PREFIX = 'vt_nudge_dismissed_'; // + nudgeId  → ISO timestamp
const SESSION_FLAG = 'vt_nudge_shown_this_session';
const BANK_OFFERED_KEY = 'vt_bank_connect_offered_'; // + householdId
const LOG_THRESHOLD = 5; // ≥5 real logs before the FIRST bank-connect offer
const CHECK_IN_DAYS = [7, 14, 21] as const;

function dismissed(id: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(DISMISS_PREFIX + id) != null;
}

export function dismissNudge(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(DISMISS_PREFIX + id, new Date().toISOString()); } catch { /* ignore */ }
}

/** Has a capture nudge already shown this session? (rate-limit, §6.3) */
export function nudgeShownThisSession(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(SESSION_FLAG) === '1';
}

export function markNudgeShownThisSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem(SESSION_FLAG, '1'); } catch { /* ignore */ }
}

export function markBankConnectOffered(householdId: string): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(BANK_OFFERED_KEY + householdId, new Date().toISOString()); } catch { /* ignore */ }
}

function bankConnectAlreadyOffered(householdId: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(BANK_OFFERED_KEY + householdId) != null;
}

function daysBetween(fromIso: string, now: number): number {
  return Math.floor((now - new Date(fromIso).getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Compute the single nudge to show, honoring all governance rules. Returns null
 * when nothing should show (flag off, not completed, rate-limited, dismissed,
 * window closed with nothing urgent, etc.). The caller is responsible for marking
 * it shown (markNudgeShownThisSession) and, for bank-connect, markBankConnectOffered.
 */
export function getActiveNudge(input: NudgeInputs): Nudge | null {
  if (!isOnboardingEnabled()) return null;

  const now = input.now ?? Date.now();
  const rec = getOnboarding(input.householdId);

  // Nudges belong to a completed baseline. Pre-completion the flow itself is the
  // surface; skipped/not-started households get no capture nudges.
  if (rec.state !== 'completed' || !rec.completedAt) return null;

  const days = daysBetween(rec.completedAt, now);
  const windowDays = FEATURES.onboarding.confirmationWindowDays;
  const pct = input.confirmedPct;

  const candidates: Nudge[] = [];

  // ── 1) Day 7 / 14 / 21 check-in (highest priority within the window). Only the
  //       most recent crossed milestone that hasn't been dismissed. After day 21
  //       active nudging tapers — no new check-ins (§5.3). ──────────────────────
  const crossed = CHECK_IN_DAYS.filter(d => days >= d);
  const milestone = crossed[crossed.length - 1];
  if (milestone && days <= windowDays && pct != null && pct < 80) {
    candidates.push({
      id: `check_in_${input.householdId}_d${milestone}`,
      kind: 'check_in',
      title: `Day ${milestone} check-in`,
      body: `Your picture is ${pct}% confirmed. A couple of taps gets you toward 80%.`,
      cta: 'Confirm estimates',
      href: '/dashboard',
    });
  }

  // ── 2) Confirm an outstanding estimate (within the window; tapers after). ─────
  if (days <= windowDays) {
    const outstanding = input.unconfirmedEstimates;
    if (outstanding > 0) {
      candidates.push({
        id: `confirm_estimate_${input.householdId}`,
        kind: 'confirm_estimate',
        title: 'Firm up your estimates',
        body: `You have ${outstanding} estimated ${outstanding === 1 ? 'value' : 'values'} from setup. Confirm or edit them as real money moves.`,
        cta: 'Review estimates',
        href: '/budgets',
      });
    }
  }

  // ── 3) Bank-connect offer — NEVER at signup; only after the user has seen value
  //       (≥5 real logs) and only once. Lowest priority (§6.1/§6.2). ────────────
  if (input.logCount >= LOG_THRESHOLD && !bankConnectAlreadyOffered(input.householdId)) {
    candidates.push({
      id: `bank_connect_${input.householdId}`,
      kind: 'bank_connect',
      title: 'Tired of typing?',
      body: 'Connect your bank and Vyact logs transactions automatically. Totally optional.',
      cta: 'Learn more',
      href: '/settings',
    });
  }

  // Apply dismissals + session rate-limit, return the top survivor.
  for (const n of candidates) {
    if (dismissed(n.id)) continue;
    if (nudgeShownThisSession()) return null; // one capture nudge per session
    return n;
  }
  return null;
}
