// T5B-003..009 — v10.121.0 (Track T5b; audit XC-ARC-11, XC-ARC-10, XC-ARC-08, BE-FN-09).
// Engineering guardrails in the app, each pinned by behaviour:
// - a write that fails is recorded, never swallowed (failedWrite; the legacy recurring import keeps what
//   did not land; onboarding's steps say which failed; sign-out's cache purge is loud);
// - a write that follows an await lands only in the household it was made for (store/landIn.ts), and the
//   slices keep it that way (a structural check over every post-await `set(`);
// - the account pickers read the household's accounts in every build (the Money Map flag is retired);
// - a 'settled' or 'closed' split email that didn't go out is said, as 'shared' already was.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import ts from 'typescript';

vi.mock('../supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supabase')>()), isCloudEnabled: () => false, supabase: null,
}));
const email = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../splitEmail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../splitEmail')>()), sendSplitEmail: email.send,
}));
const cloudSplits = vi.hoisted(() => ({ settle: vi.fn(), close: vi.fn() }));
vi.mock('../sharedSplits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sharedSplits')>()),
  settleSharedSplitShare: cloudSplits.settle, closeSharedSplit: cloudSplits.close,
}));

import { clearFaults, failedWrite, getFaults } from '../faults';
import { splitEmailNotice } from '../splitEmail';
import { wireOnboardingToMoney } from '../onboardingWiring';
import { buildAccountsFromStore, notInvestment } from '../accounts';
import * as accountsLib from '../accounts';
import * as featureFlags from '../featureFlags';
import { importLegacyRecurring, LEGACY_RECURRING_HID } from '../../store/legacyRecurring';
import { readLocalJson, readLocalString, setLocalJson } from '../../store/localJson';
import { landIn } from '../../store/landIn';
import { useStore, type Store } from '../../store';
import type { Account, RecurringSchedule } from '../../types';

const ROOT = resolvePath(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolvePath(ROOT, path), 'utf8');

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
}
const g = globalThis as unknown as { localStorage?: MemStorage };
beforeEach(() => {
  g.localStorage = new MemStorage();
  clearFaults();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete g.localStorage; });
const faults = () => getFaults().map(f => [f.context, f.kind]);

describe('a failed write is recorded, never swallowed (XC-ARC-11)', () => {
  it('T5B-003 · failedWrite: no network is the expected offline path; a refusal or a bug is unexpected', () => {
    failedWrite(new TypeError('Failed to fetch'), 'fetch');
    failedWrite({ message: 'TypeError: NetworkError when attempting to fetch resource.', details: '', code: '' }, 'postgrest-network');
    failedWrite({ code: '23514', message: 'new row violates check constraint' }, 'refused');
    failedWrite(new Error('boom'), 'bug');
    vi.stubGlobal('navigator', { onLine: false });
    failedWrite(new Error('anything at all'), 'offline');
    expect(faults()).toEqual([
      ['fetch', 'expected'], ['postgrest-network', 'expected'], ['refused', 'unexpected'], ['bug', 'unexpected'], ['offline', 'expected'],
    ]);
  });

  it('T5B-004 · the legacy recurring import keeps a schedule that failed, tries it again next load, and never imports into a household that has its own', async () => {
    const a = { id: 'a', frequency: 'monthly' } as RecurringSchedule, b = { id: 'b', frequency: 'monthly' } as RecurringSchedule;
    setLocalJson('recurring', [a, b]);
    const stored: string[] = [];
    let failB = true;
    const adapter = { upsert: vi.fn(async (_e: string, _h: string, row: unknown) => {
      const id = (row as { id: string }).id;
      if (id === 'b' && failB) throw new Error('quota exceeded');
      stored.push(id);
      return row;
    }) } as unknown as Parameters<typeof importLegacyRecurring>[0];

    expect(await importLegacyRecurring(adapter, 'h1', false)).toBe(true);
    expect(stored).toEqual(['a']);
    // It used to retire the key here, losing b without a word.
    expect(readLocalJson<RecurringSchedule[]>('recurring', []).map(s => s.id)).toEqual(['b']);
    expect(readLocalString(LEGACY_RECURRING_HID)).toBe('h1');
    expect(faults()).toEqual([['init.legacyRecurring:upsert', 'unexpected']]);

    // Next load: the household now has a's row, yet the import resumes for b, its own household.
    failB = false;
    expect(await importLegacyRecurring(adapter, 'h1', true)).toBe(true);
    expect(stored).toEqual(['a', 'b']);
    expect(readLocalJson<RecurringSchedule[]>('recurring', [])).toEqual([]);
    expect(readLocalString(LEGACY_RECURRING_HID)).toBeNull();

    // A leftover list never lands in ANOTHER household that has schedules (the v8.9 guard stands).
    setLocalJson('recurring', [{ id: 'c' }]);
    expect(await importLegacyRecurring(adapter, 'h2', true)).toBe(false);
    expect(stored).toEqual(['a', 'b']);
  });

  it('T5B-005 · onboarding: each step that fails is recorded, the others still run, and a join-month budget that exists is expected', async () => {
    const cash = { id: 'cash1', kind: 'cash', name: 'Cash in Hand', currency: 'INR', openingBalance: 0 } as Account;
    const upsertRecurring = vi.fn().mockRejectedValue(new Error('boom'));
    await wireOnboardingToMoney({
      monthlyIncome: 50000, currency: 'INR', now: new Date(Date.UTC(2026, 9, 19)),
      bills: [{ key: 'rent', label: 'Rent', amount: 15000 }, { key: 'internet', label: 'Internet', amount: 800 }],
      fns: {
        ensureDefaultCashAccount: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
        getCashAccount: () => cash,
        upsertAccount: vi.fn().mockRejectedValue({ code: '42501', message: 'permission denied' }),
        upsertRecurring,
        saveOnboardingBudget: vi.fn().mockRejectedValue(new Error('BUDGET_EXISTS')),
      },
    });
    expect(upsertRecurring).toHaveBeenCalledTimes(3);              // the paycheck and both bills were still tried
    expect(faults()).toEqual([
      ['onboarding.cashAccount', 'expected'], ['onboarding.openingBalance', 'unexpected'],
      ['onboarding.paycheck', 'unexpected'], ['onboarding.bill', 'unexpected'], ['onboarding.bill', 'unexpected'],
      ['onboarding.budget', 'expected'],
    ]);
    expect(read('react/src/lib/onboardingWiring.ts')).not.toMatch(/\.catch\(\(\) => \{\}\)/);
  });
});

describe('a store write after an await lands only in its own household (XC-ARC-10)', () => {
  it('T5B-006 · landIn drops a result for a household no longer open; the store\'s saves and deletes use it', async () => {
    // The helper itself.
    let state = { currentHouseholdId: 'h1', goals: [] as unknown[] } as unknown as Store;
    const set = (update: (s: Store) => Partial<Store>) => { state = { ...state, ...update(state) }; };
    const commit = landIn(set, () => state);
    expect(commit('h1', { goals: [{ id: 'g1' }] } as never)).toBe(true);
    expect(commit('h2', s => ({ goals: [...s.goals, { id: 'g2' }] }) as never)).toBe(false);
    expect((state.goals as { id: string }[]).map(x => x.id)).toEqual(['g1']);

    // Through the store: a save still in flight when the household changes lands in its own household
    // only (the adapter wrote it there), never in the list now on screen.
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const adapter = {
      upsert: vi.fn(async (_e: string, _h: string, row: unknown) => { await gate; return { ...(row as object), updated_at: 'rev' }; }),
      remove: vi.fn(async () => { await gate; }),
    };
    useStore.setState({ ...useStore.getInitialState(), adapter: adapter as never, currentHouseholdId: 'h1', goals: [],
      transactions: [{ id: 't1', type: 'expense', amount: 1, currency: 'INR', date: '2026-10-19', description: 'h1 row', category: 'food' }] as never });
    const saving = useStore.getState().upsertGoal({ id: 'g1', name: 'Trip' } as never);
    const deleting = useStore.getState().removeTransaction('t1');
    useStore.setState({ currentHouseholdId: 'h2', goals: [],
      transactions: [{ id: 't1', type: 'expense', amount: 9, currency: 'INR', date: '2026-10-19', description: 'h2 row', category: 'food' }] as never });
    release();
    await Promise.all([saving, deleting]);
    expect(adapter.upsert).toHaveBeenCalledWith('goals', 'h1', expect.anything(), undefined);
    expect(useStore.getState().goals).toEqual([]);
    expect(useStore.getState().transactions.map(t => t.description)).toEqual(['h2 row']);

    // With no switch, both land as before.
    useStore.setState({ currentHouseholdId: 'h1', goals: [],
      transactions: [{ id: 't2', type: 'expense', amount: 1, currency: 'INR', date: '2026-10-19', description: 'x', category: 'food' }] as never });
    await Promise.all([useStore.getState().upsertGoal({ id: 'g2', name: 'Car' } as never), useStore.getState().removeTransaction('t2')]);
    expect(useStore.getState().goals.map(x => x.id)).toEqual(['g2']);
    expect(useStore.getState().transactions).toEqual([]);
  });

  it('T5B-007 · every store write after an await goes through commit, except the person\'s own lists and actions that check the household themselves', () => {
    // file:action → why a plain set() after an await is right there.
    const allowed: Record<string, string> = {
      'cloudAuthSlice.ts:refreshHouseholds': 'the households list is the person\'s; the role is set only if the household is still open',
      'crudSlice.ts:ensureDefaultCashAccount': 'checks the household itself before it sets',
      'dataSlice.ts:init': 'chooses the household it then fills',
      'dataSlice.ts:refresh': 'isStale() drops a refresh overtaken by a newer one or a switch',
      'dataSlice.ts:recordNetWorthSnapshot': 'checks the household itself before it sets',
      'dataSlice.ts:switchHousehold': 'is the switch',
      'dataSlice.ts:createHousehold': 'the households list is the person\'s',
      'dataSlice.ts:deleteHousehold': 'the households list is the person\'s',
      'dataSlice.ts:renameHousehold': 'the households list is the person\'s',
      'dataSlice.ts:updateProfile': 'the households list is the person\'s; the profile and accounts go through commit',
      'invitationsSlice.ts:refreshInvitations': 'the person\'s invitations; the household\'s only while it is open',
      'invitationsSlice.ts:joinInvitation': 'the person\'s invitations',
      'invitationsSlice.ts:declineMyInvitation': 'the person\'s invitations',
      'invitationsSlice.ts:revokeHouseholdInvitation': 'removes one invitation by id, wherever it is listed',
      'sharedSplitsSlice.ts:refreshSharedSplits': 'shared splits are the person\'s, across households',
      'sharedSplitsSlice.ts:deleteSharedSplitForTxn': 'shared splits are the person\'s, across households',
    };
    const dir = resolvePath(ROOT, 'react/src/store/slices');
    const found = new Set<string>();
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const text = readFileSync(resolvePath(dir, file), 'utf8');
      const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const fnOf = (n: ts.Node) => { let p = n.parent; while (p && !ts.isFunctionLike(p)) p = p.parent; return p; };
      const awaits = new Map<ts.Node, number[]>();
      const scan = (n: ts.Node): void => {
        if (ts.isAwaitExpression(n)) { const fn = fnOf(n); if (fn) awaits.set(fn, [...(awaits.get(fn) ?? []), n.getStart(src)]); }
        ts.forEachChild(n, scan);
      };
      scan(src);
      const sets = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'set') {
          const fn = fnOf(n);
          if (fn && (awaits.get(fn) ?? []).some(at => at < n.getStart(src))) {
            let p: ts.Node | undefined = n.parent;
            while (p && !ts.isPropertyAssignment(p)) p = p.parent;
            found.add(`${file}:${p ? (p as ts.PropertyAssignment).name.getText(src) : '?'}`);
          }
        }
        ts.forEachChild(n, sets);
      };
      sets(src);
    }
    expect([...found].sort()).toEqual(Object.keys(allowed).sort());
    for (const file of ['crudSlice.ts', 'dataSlice.ts', 'recurringSlice.ts', 'notifySlice.ts']) {
      expect(read(`react/src/store/slices/${file}`)).toMatch(/const commit = landIn\(set, get\);/);
    }
  });
});

describe('the account pickers read the household\'s accounts in every build (XC-ARC-08)', () => {
  it('T5B-008 · the Money Map flag and the assets + debts derivation are gone; the list is the accounts', () => {
    expect('getMoneyMapMode' in featureFlags).toBe(false);
    expect('buildAccounts' in accountsLib).toBe(false);
    for (const form of ['react/src/components/transactions/TransactionFormModal.tsx', 'react/src/components/splits/SplitFormModal.tsx']) {
      expect(read(form)).not.toMatch(/getMoneyMapMode|featureFlags|buildAccounts\(/);
    }
    const accounts = [
      { id: 'c', kind: 'cash', name: 'Cash in Hand' }, { id: 'b', kind: 'bank', name: 'HDFC Salary' },
      { id: 'k', kind: 'credit_card', name: 'Amex', debtId: 'd1' }, { id: 'i', kind: 'investment', name: 'Index fund' },
      { id: 'o', kind: 'bank', name: 'Old bank', isArchived: true }, { id: 'l', kind: 'loan', name: 'Car loan' },
    ] as Account[];
    expect(buildAccountsFromStore(accounts, { filter: notInvestment }).map(o => [o.value, o.label])).toEqual([
      ['cash', 'Cash in Hand'], ['asset:b', 'HDFC Salary'], ['debt:d1', 'Amex'],
    ]);
    // Lane A (local-only) now moves the account an e2e entry names, so the Net Worth deposit test runs.
    expect(read('react/e2e/tests/networth-impact.spec.ts')).not.toMatch(/test\.fixme\(/);
  });
});

describe('a split email that didn\'t go out is said, for every event (BE-FN-09)', () => {
  it('T5B-009 · settled and closed get their own notice after the action\'s own message; a sent email says nothing more', async () => {
    expect(splitEmailNotice({ ok: true }, 'settled')).toBeNull();
    expect(splitEmailNotice({ ok: false, reason: 'email_not_configured' }, 'settled'))
      .toBe("The email to the person you paid couldn't be sent. They'll see it when they open Vyact.");
    expect(splitEmailNotice({ ok: false, reason: 'daily_limit' }, 'closed'))
      .toBe("You've reached today's limit for split emails. Everyone on the split will see it closed when they open Vyact.");
    expect(splitEmailNotice({ ok: false, reason: 'unreachable' }, 'closed'))
      .toBe("The email saying the split is closed couldn't be sent. Everyone on it will see it when they open Vyact.");
    expect(splitEmailNotice({ ok: false, reason: 'unreachable' }))
      .toBe("Split shared. They'll see it when they open Vyact, but the email couldn't be sent.");

    const toast = vi.fn();
    useStore.setState({ ...useStore.getInitialState(), toast, cloudEnabled: false });
    cloudSplits.settle.mockResolvedValue(undefined);
    cloudSplits.close.mockResolvedValue(undefined);
    email.send.mockResolvedValueOnce({ ok: false, reason: 'email_not_configured' });
    await useStore.getState().settleMySplitShare('share-1');
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(toast.mock.calls).toEqual([
      ['Marked your share as settled', 'success'],
      ["The email to the person you paid couldn't be sent. They'll see it when they open Vyact.", 'info'],
    ]);
    expect(email.send).toHaveBeenCalledWith({ shareId: 'share-1', event: 'settled' });

    toast.mockClear();
    email.send.mockResolvedValueOnce({ ok: true, sent: 2, recipients: 2 });
    await useStore.getState().closeMySplit('split-1');
    await vi.waitFor(() => expect(email.send).toHaveBeenCalledWith({ splitId: 'split-1', event: 'closed' }));
    await new Promise(r => setTimeout(r, 0));
    expect(toast.mock.calls).toEqual([['Split closed', 'success']]);
  });
});
