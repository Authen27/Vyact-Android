// FinFlow E2E — deterministic seed data + browser-side seeding script.
//
// Test data is FIXED (not generated via the app's random `seed.ts`) so that
// assertions are stable. Keys mirror LocalStorageAdapter's anonymous-mode
// layout: `ff_<entity>` for the 'local' household (see src/lib/dataAdapter.ts).

export const FIXED_NOW = '2026-05-22T12:00:00.000Z';
export const FIXED_NOW_MS = Date.parse(FIXED_NOW);

export interface SeedData {
  transactions?: unknown[];
  budgets?: unknown[];
  goals?: unknown[];
  debts?: unknown[];
  assets?: unknown[];
  members?: unknown[];
  profile?: unknown;
  // v6.5 — added for the feature-test scaffolding (PR #scaffold-1).
  recurringSchedules?: unknown[];
  notifications?: unknown[];
  exchangeRates?: Record<string, number>;
}

/**
 * Deep-merge a partial override onto the defaultSeed. Use this in journey
 * tests that only need a small delta from the household-shaped baseline:
 *
 *   test.use({ seed: seedWith({ debts: [myDebt], profile: { baseCurrency: 'EUR' } }) });
 *
 * Arrays REPLACE the default — that's intentional; tests that want extra
 * transactions on top of the seed should spread `defaultSeed.transactions`:
 *
 *   seedWith({ transactions: [...defaultSeed.transactions!, myExtra] })
 *
 * Objects (profile, exchangeRates) shallow-merge so you can override one key.
 */
export function seedWith(override: Partial<SeedData>): SeedData {
  const out: SeedData = { ...defaultSeed };
  for (const k of Object.keys(override) as (keyof SeedData)[]) {
    const v = override[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      // Arrays replace.
      (out as Record<string, unknown>)[k] = v;
    } else if (typeof v === 'object' && v !== null) {
      // Objects shallow-merge.
      (out as Record<string, unknown>)[k] = {
        ...(out[k] as Record<string, unknown> | undefined),
        ...(v as Record<string, unknown>),
      };
    } else {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

// A small, realistic household used by journey tests. All amounts in USD.
export const defaultSeed: SeedData = {
  profile: {
    name: 'Test User', email: 'test@example.com', baseCurrency: 'USD',
    language: 'en', household: 'family', dateFormat: 'us',
    payoffStrategy: 'avalanche', extraPayment: 0,
  },
  transactions: [
    { id: '00000000-0000-4000-8000-000000000001', type: 'income',  amount: 5000, currency: 'USD', date: '2026-05-01', description: 'E2E Salary',  category: 'salary' },
    { id: '00000000-0000-4000-8000-000000000002', type: 'expense', amount: 1200, currency: 'USD', date: '2026-05-05', description: 'E2E Rent',    category: 'housing' },
    { id: '00000000-0000-4000-8000-000000000003', type: 'expense', amount:  350, currency: 'USD', date: '2026-05-10', description: 'E2E Grocery', category: 'food' },
  ],
  budgets: [
    { id: '00000000-0000-4000-8000-0000000000b1', category: 'food', limit: 300, currency: 'USD' },
  ],
  goals: [
    { id: '00000000-0000-4000-8000-0000000000c1', type: 'emergency', name: 'E2E Emergency Fund', target: 10000, current: 4000, currency: 'USD', completed: false },
  ],
  debts: [],
  assets: [
    // type 'checking' (not 'cash') so it surfaces as its OWN selectable
    // account in the transaction form. A 'cash'-type asset is folded into
    // the generic "Cash" option (see lib/accounts.ts:buildAccounts) and would
    // not be selectable by name.
    { id: '00000000-0000-4000-8000-0000000000d1', type: 'checking', name: 'E2E Checking', value: 8000, currency: 'USD', liquidity: 'liquid' },
  ],
};

/**
 * A 30-day amortising debt used by the DEBT-FC suite (C-tier golden test).
 * Numbers are chosen so interest/principal splits are non-trivial to compute
 * by hand — forces tests to use dinero-precise expectations, not eyeballed ones.
 */
export const sampleCreditCardDebt = {
  id: '00000000-0000-4000-8000-0000000000e1',
  type: 'credit_card',
  name: 'E2E Credit Card',
  lender: 'TestBank',
  principal: 5000,
  currentBalance: 5000,
  interestRate: 18.5,           // APR (%, annual)
  minimumPayment: 150,
  currency: 'USD',
  paymentLog: [],
};

/**
 * Runs IN THE BROWSER via page.addInitScript, before any app code. Writes the
 * seed into localStorage so the app boots straight into a populated household.
 */
export function seedScript(data: SeedData) {
  // Idempotent: addInitScript runs on EVERY navigation/reload. Seeding only
  // when the household is not yet present means (a) seeded data still loads on
  // first boot, and (b) records the test ADDS during the run survive a reload
  // instead of being clobbered back to the seed on every page load.
  // If either legacy or new active_profile exists, skip seeding.
  if (localStorage.getItem('ff_active_profile') || localStorage.getItem('vt_active_profile')) return;

  // Persist both vt_ and ff_ keys so older bundles and new bundles both see the seed.
  localStorage.setItem('ff_active_profile', 'local');
  localStorage.setItem('vt_active_profile', 'local');
  localStorage.setItem('ff_profiles_list', JSON.stringify([{
    id: 'local', name: 'My Household', type: 'family',
    baseCurrency: 'USD', createdAt: '2026-01-01T00:00:00.000Z',
  }]));
  const w = (k: string, v: unknown) => {
    localStorage.setItem('ff_' + k, JSON.stringify(v));
    localStorage.setItem('vt_' + k, JSON.stringify(v));
  };
  if (data.profile)      w('profile', data.profile);
  if (data.transactions) w('transactions', data.transactions);
  if (data.budgets)      w('budgets', data.budgets);
  if (data.goals)        w('goals', data.goals);
  if (data.debts)        w('debts', data.debts);
  if (data.assets)       w('assets', data.assets);
  if (data.members)      w('members', data.members);
  if (data.exchangeRates) w('rates', data.exchangeRates);
}

/**
 * Legacy-only variant for the v7 brand-migration regression guard. This
 * simulates a pre-v7 install where only `ff_*` keys exist and proves the
 * compat read-path still boots the app before new writes move to `vt_*`.
 */
export function legacyOnlySeedScript(data: SeedData) {
  if (localStorage.getItem('ff_active_profile') || localStorage.getItem('vt_active_profile')) return;

  localStorage.setItem('ff_active_profile', 'local');
  localStorage.setItem('ff_profiles_list', JSON.stringify([{
    id: 'local', name: 'My Household', type: 'family',
    baseCurrency: 'USD', createdAt: '2026-01-01T00:00:00.000Z',
  }]));

  const w = (k: string, v: unknown) => {
    localStorage.setItem('ff_' + k, JSON.stringify(v));
  };
  if (data.profile)      w('profile', data.profile);
  if (data.transactions) w('transactions', data.transactions);
  if (data.budgets)      w('budgets', data.budgets);
  if (data.goals)        w('goals', data.goals);
  if (data.debts)        w('debts', data.debts);
  if (data.assets)       w('assets', data.assets);
  if (data.members)      w('members', data.members);
  if (data.exchangeRates) w('rates', data.exchangeRates);
}

/**
 * Runs IN THE BROWSER before app code. Pins `crypto.randomUUID` to a stable
 * counter so any records the app creates during a test get predictable ids
 * (helps future snapshot/equality assertions). Clock is frozen separately via
 * Playwright's `page.clock` API in the app fixture.
 */
export function determinismScript() {
  let n = 0;
  const stable = () =>
    ('00000000-0000-4000-9000-' + String(++n).padStart(12, '0')) as `${string}-${string}-${string}-${string}-${string}`;
  try {
    if (typeof crypto !== 'undefined') {
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: stable });
    }
  } catch { /* non-fatal */ }
}
