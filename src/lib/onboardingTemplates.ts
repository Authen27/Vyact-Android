// Vyact — per-segment onboarding content (spec §4.2).
//
// One flow engine reads steps 2–4 content from this static map keyed by segment.
// Steps 0, 1, 5 are shared and live in the page. Per the spec, copy here is the
// buildable contract; sub-segmentation inside a path can be added later without
// touching the spine.

import type { Segment } from './onboardingState';

export interface ChipOption {
  key: string;
  label: string;
}

export interface ContextQuestion {
  /** which OnboardingContext field this answer writes to */
  field: 'adultCount' | 'dependents' | 'incomeType' | 'businessType';
  prompt: string;
  options: ChipOption[];
}

export interface SegmentTemplate {
  segment: Segment;
  icon: string;
  label: string;
  blurb: string;
  /** Step 2 — Context: 2–3 taps max (spec §4.1 input cap). */
  context: ContextQuestion[];
  /** Step 3 — Snapshot: which balances to capture (≤2 inputs). */
  snapshot: { key: string; label: string; hint: string }[];
  /** Step 4 — Forward Model: suggested fixed-cost chips (income captured inline). */
  fixedCostChips: ChipOption[];
  /** Modules made visible on completion. */
  visibleModules: string[];
  /** Pulse weighting bias label. */
  pulseBias: string;
  /** Signature Reveal one-liner (step 5). */
  revealLine: string;
}

// v9.6.1 — the "Save for a goal" concern was removed: Goals were discarded as a
// module (v8.8.0), so the option pointed at a non-existent surface. The remaining
// concerns all map to live modules (spending → Budgets/Transactions, debt → Debts,
// runway → Net Worth / SMB burn).
const PRIMARY_CONCERNS: ChipOption[] = [
  { key: 'spending', label: 'Track spending' },
  { key: 'debt', label: 'Pay off debt' },
  { key: 'runway', label: 'Extend runway' },
];

export const SEGMENTS: Record<Segment, SegmentTemplate> = {
  individual: {
    segment: 'individual',
    icon: '🧍',
    label: 'Just me',
    blurb: 'A personal picture of where your money goes.',
    context: [
      {
        field: 'incomeType',
        prompt: 'How does your income arrive?',
        options: [
          { key: 'steady', label: 'Steady paycheck' },
          { key: 'variable', label: 'Varies month to month' },
        ],
      },
    ],
    snapshot: [
      { key: 'cash', label: 'Cash on hand', hint: 'Roughly what sits in checking + savings today' },
      { key: 'debt', label: 'Total debt', hint: 'Cards, loans — a ballpark is fine' },
    ],
    fixedCostChips: [
      { key: 'rent', label: 'Rent / mortgage' },
      { key: 'utilities', label: 'Utilities' },
      { key: 'phone', label: 'Phone' },
      { key: 'subscriptions', label: 'Subscriptions' },
      { key: 'transport', label: 'Transport' },
    ],
    visibleModules: ['Dashboard', 'Transactions', 'Budgets', 'Reports'],
    pulseBias: 'savings + control',
    revealLine: "Here's your month at a glance",
  },
  household: {
    segment: 'household',
    icon: '👨‍👩‍👧',
    label: 'My household',
    blurb: 'Shared money for a family or partners.',
    context: [
      {
        field: 'adultCount',
        prompt: 'How many adults share the money?',
        options: [
          { key: '1', label: 'Just me' },
          { key: '2', label: 'Two of us' },
          { key: '3', label: 'More' },
        ],
      },
      {
        field: 'dependents',
        prompt: 'Any dependents?',
        options: [
          { key: 'none', label: 'None' },
          { key: 'kids', label: 'Kids' },
          { key: 'other', label: 'Other' },
        ],
      },
    ],
    snapshot: [
      { key: 'cash', label: 'Household cash', hint: 'Combined checking + savings, roughly' },
      { key: 'debt', label: 'Household debt', hint: 'Mortgage, cards, loans — a ballpark' },
    ],
    fixedCostChips: [
      { key: 'mortgage', label: 'Mortgage / rent' },
      { key: 'utilities', label: 'Utilities' },
      { key: 'childcare', label: 'Childcare' },
      { key: 'groceries', label: 'Groceries' },
      { key: 'insurance', label: 'Insurance' },
      { key: 'subscriptions', label: 'Subscriptions' },
    ],
    visibleModules: [
      'Dashboard', 'Transactions', 'Budgets', 'Reports',
      'Members', 'Debts', 'Net Worth', 'Splits',
    ],
    pulseBias: 'balanced',
    revealLine: "You're set — invite your partner?",
  },
  smb: {
    segment: 'smb',
    icon: '💼',
    label: 'My business',
    blurb: 'Cash runway and burn for a small business.',
    context: [
      {
        field: 'businessType',
        prompt: 'What kind of business?',
        options: [
          { key: 'solo', label: 'Solo / freelance' },
          { key: 'team', label: 'Has a team' },
          { key: 'side_business', label: 'Side business' },
        ],
      },
    ],
    snapshot: [
      { key: 'cash', label: 'Cash in the business', hint: 'Total across business accounts' },
      { key: 'debt', label: 'Business debt', hint: 'Loans, credit lines — a ballpark' },
    ],
    fixedCostChips: [
      { key: 'payroll', label: 'Payroll' },
      { key: 'rent', label: 'Rent' },
      { key: 'software', label: 'Software' },
      { key: 'contractors', label: 'Contractors' },
      { key: 'marketing', label: 'Marketing' },
      { key: 'taxes', label: 'Tax reserve' },
    ],
    visibleModules: [
      'Dashboard', 'Transactions', 'Budgets', 'Net Worth', 'Debts', 'Reports',
    ],
    pulseBias: 'business health (runway / burn)',
    revealLine: '~X months runway at current burn',
  },
};

export const SEGMENT_ORDER: Segment[] = ['individual', 'household', 'smb'];

export { PRIMARY_CONCERNS };
