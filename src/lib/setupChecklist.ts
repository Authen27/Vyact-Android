// Aurora 4.0 FR1 / FR2 — the first Dashboard after onboarding.
//
// FR1 "Finish setting up": five steps, each worked out from what the household already holds (no new
// tables): income and fixed bills from setup, the bills waiting for a yes, the accounts you pay from,
// a week of logged spending, and inviting the others in a couple or family. It shows only after a
// real onboarding (state `completed` — seeded and older households are `skipped`), and disappears
// once every step is done or the person hides it. "Hidden" and "reviewed the bills" are per-person,
// per-household flags on this device (a non-owner cannot write the household row).
//
// FR2: the estimate hero's "Room left this month" — pay less the fixed bills from setup, less what has
// been logged this month that is NOT one of those bills (a posted bill must not be subtracted twice).
// It is an estimate (`EstimatedTag`), never mixed into Cash Flow, and goes when the baseline does.
import type { ProfileTypeKey } from '../types';

export interface SetupInputs {
  /** Onboarding finished (not skipped). */
  onboardingCompleted: boolean;
  /** Setup chose "I'll add bills later" and no expense schedule exists yet. */
  billsMissing: boolean;
  /** Approval-gated bills that have never posted: their descriptions. */
  waitingBills: string[];
  /** The person opened Recurring since setup. */
  reviewedBills: boolean;
  /** Bank and card accounts (Cash in Hand and loan accounts excluded). */
  payingAccounts: number;
  /** Distinct days with an entry since setup. */
  loggedDays: number;
  householdType: ProfileTypeKey;
  /** Someone else is in the household, or an invitation is open. */
  othersInvited: boolean;
}

export type SetupAction = 'recurring' | 'accounts' | 'addTxn' | 'households';

export interface SetupStep {
  id: 'income' | 'bills' | 'accounts' | 'week' | 'invite';
  title: string;
  detail: string;
  done: boolean;
  action: SetupAction;
}

export const WEEK_DAYS = 7;

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function setupSteps(i: SetupInputs): SetupStep[] {
  const steps: SetupStep[] = [];
  steps.push(i.billsMissing
    ? { id: 'income', title: 'Add your fixed bills', detail: 'Rent, phone, subscriptions — so the month adds up', done: false, action: 'recurring' }
    : { id: 'income', title: 'Income and fixed bills', detail: 'Added during setup', done: true, action: 'recurring' });

  const waiting = i.waitingBills.length;
  if (waiting > 0 || i.reviewedBills) {
    const names = i.waitingBills.slice(0, 2);
    steps.push({
      id: 'bills',
      title: waiting > 0 && !i.reviewedBills ? `Review ${waiting} ${waiting === 1 ? 'bill' : 'bills'} waiting` : 'Review your bills',
      detail: waiting > 0
        ? `${list(names)}${waiting > names.length ? ` and ${waiting - names.length} more` : ''} ${waiting === 1 ? 'needs' : 'need'} a yes before ${waiting === 1 ? 'it posts' : 'they post'}`
        : 'Reviewed in Recurring',
      done: i.reviewedBills || waiting === 0,
      action: 'recurring',
    });
  }

  steps.push({
    id: 'accounts', title: 'Add the accounts you pay from', detail: 'So balances match your bank',
    done: i.payingAccounts > 0, action: 'accounts',
  });

  const days = Math.min(i.loggedDays, WEEK_DAYS);
  steps.push({
    id: 'week', title: 'Log a week of spending',
    detail: days > 0 && days < WEEK_DAYS ? `${days} of ${WEEK_DAYS} days so far` : 'The forecast sharpens after 7 days',
    done: i.loggedDays >= WEEK_DAYS, action: 'addTxn',
  });

  if (i.householdType === 'couple' || i.householdType === 'family') {
    steps.push({
      id: 'invite',
      title: i.householdType === 'couple' ? 'Invite your partner' : 'Invite your family',
      detail: 'One picture for the whole household',
      done: i.othersInvited, action: 'households',
    });
  }
  return steps;
}

/** Shown only after a real onboarding, until it is hidden or every step is done. */
export function setupVisible(steps: SetupStep[], onboardingCompleted: boolean, hidden: boolean): boolean {
  return onboardingCompleted && !hidden && steps.some(s => !s.done);
}

/** FR2 — pay less fixed bills, less what was logged this month that is not one of those bills. */
export function roomLeftEstimate(pay: number, fixedBills: number, loggedNotBills: number): number {
  return Math.round((pay - fixedBills - loggedNotBills) * 100) / 100;
}

// ── Per-person flags (this device) ────────────────────────────────────────────

interface Flags { hidden?: boolean; reviewedBills?: boolean }
const key = (householdId: string) => `vyact:setup:${householdId}`;

export function readSetupFlags(householdId: string): Flags {
  try { return JSON.parse(localStorage.getItem(key(householdId)) ?? '{}') as Flags; } catch { return {}; }
}

export function writeSetupFlag(householdId: string, flag: keyof Flags): void {
  try { localStorage.setItem(key(householdId), JSON.stringify({ ...readSetupFlags(householdId), [flag]: true })); } catch { /* fault-ok: storage blocked: the flag lasts this session */ }
}
