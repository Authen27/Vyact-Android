// Aurora 4.0 · A4 states and first run (v10.103.0) — EM1, LD1, FR1, FR2, FR3, D1, D2, ON3.
// Each case is named after its change code.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import EmptyState from '../../components/ui/EmptyState';
import { PageSkeleton, shapeForPath } from '../../components/ui/Skeleton';
import { roomLeftEstimate, setupSteps, setupVisible, type SetupInputs } from '../setupChecklist';

vi.stubGlobal('React', React);
const src = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf8').replace(/\r\n/g, '\n');
const html = (node: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

const base: SetupInputs = {
  onboardingCompleted: true, billsMissing: false, waitingBills: ['Rent', 'Netflix'], reviewedBills: false,
  payingAccounts: 0, loggedDays: 3, householdType: 'couple', othersInvited: false,
};

describe('A4 · states and first run', () => {
  it('A4-EM1-001 · an empty state explains: icon tile, heading, one sentence, one action, a Pip hint', () => {
    const out = html(<EmptyState icon="🧾" title="No entries yet" message="Add what you spend and earn." action={{ label: '+ Add your first expense', onClick: () => {} }} hint="or tell Pip" />);
    expect(out).toMatch(/class="well w-\[52px\] h-\[52px\]/);
    expect(out).toMatch(/>No entries yet</);
    expect(out).toMatch(/<button type="button" class="btn-primary">\+ Add your first expense<\/button>/);
    expect(out).toMatch(/>or tell Pip</);
    expect(out).not.toMatch(/uppercase|font-mono/);
    // In a panel: no tile, the action as a 44px text link.
    const compact = html(<EmptyState compact message="Nothing logged yet." action={{ label: 'Set a budget', to: '/budgets' }} />);
    expect(compact).not.toMatch(/w-\[52px\]/);
    expect(compact).toMatch(/<a class="empty-link" href="\/budgets">Set a budget<\/a>/);
    expect(read('index.css')).toMatch(/\.empty-link \{[^}]*min-height: 44px;/);
    // Every list page uses the one component (no hand-rolled empty blocks left).
    for (const page of ['Budgets', 'Splits', 'Debts', 'NetWorth', 'Transactions', 'Recurring']) {
      expect(read(`pages/${page}.tsx`), page).toMatch(/<EmptyState icon=[^]*?title="/);
    }
  });

  it('A4-LD1-001 · loading shows the page\'s own shape, not a "Loading…" word', () => {
    expect(shapeForPath('/dashboard')).toBe('dashboard');
    expect(shapeForPath('/budgets')).toBe('cards');
    expect(shapeForPath('/transactions')).toBe('list');
    const dash = html(<PageSkeleton shape="dashboard" />);
    expect(dash).toMatch(/aria-busy="true"/);
    expect(dash.match(/class="card-raised p-\[18px\]"/g)).toHaveLength(2);   // two heroes
    expect(dash).toMatch(/role="status"[^>]*>Loading your household…/);
    const app = read('App.tsx');
    expect(app).toMatch(/if \(loading\) return <AppSkeleton pathname=\{location\.pathname\} \/>;/);
    expect(app).toMatch(/<Suspense fallback=\{<PageSkeleton shape=\{shapeForPath\(location\.pathname\)\} \/>\}>/);
  });

  it('A4-FR1-001 · the setup checklist: five steps worked out from the household', () => {
    const steps = setupSteps(base);
    expect(steps.map(s => s.id)).toEqual(['income', 'bills', 'accounts', 'week', 'invite']);
    expect(steps[0]).toMatchObject({ title: 'Income and fixed bills', done: true });
    expect(steps[1]).toMatchObject({ title: 'Review 2 bills waiting', detail: 'Rent and Netflix need a yes before they post', done: false });
    expect(steps[3]).toMatchObject({ detail: '3 of 7 days so far', done: false });
    expect(steps[4]).toMatchObject({ title: 'Invite your partner', done: false });
    // ON3: bills skipped keeps the first step open.
    expect(setupSteps({ ...base, billsMissing: true, waitingBills: [] })[0]).toMatchObject({ title: 'Add your fixed bills', done: false });
    // No invite step for a personal household; a family one says "family".
    expect(setupSteps({ ...base, householdType: 'personal' }).some(s => s.id === 'invite')).toBe(false);
    expect(setupSteps({ ...base, householdType: 'family' }).find(s => s.id === 'invite')?.title).toBe('Invite your family');
    // Shown only after a real onboarding, until hidden or all done.
    expect(setupVisible(steps, false, false)).toBe(false);
    expect(setupVisible(steps, true, true)).toBe(false);
    const allDone = setupSteps({ ...base, reviewedBills: true, payingAccounts: 1, loggedDays: 9, othersInvited: true });
    expect(allDone.every(s => s.done)).toBe(true);
    expect(setupVisible(allDone, true, false)).toBe(false);
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toMatch(/<SetupChecklist \/>/);
    expect(read('pages/Recurring.tsx')).toMatch(/writeSetupFlag\(householdId, 'reviewedBills'\)/);
  });

  it('A4-FR2-001 · the estimate hero: pay less fixed bills less what was logged that is not a bill, tagged estimated', () => {
    expect(roomLeftEstimate(145000, 31619, 0)).toBe(113381);
    expect(roomLeftEstimate(145000, 31619, 4381)).toBe(109000);
    const hero = read('components/dashboard/EstimateHero.tsx');
    expect(hero).toMatch(/t\.type === 'expense' && !t\.excluded && t\.date\.startsWith\(mk\) && !t\.recurringScheduleId/);
    expect(hero).toMatch(/<EstimatedTag confidence="estimated" \/>/);
    expect(hero).toMatch(/Room left this month/);
    expect(read('pages/Dashboard.tsx')).toMatch(/\{baseline\n\s*\? <EstimateHero baseline=\{baseline\} onDismiss=\{dismissBaseline\} \/>\n\s*: <CashFlowHero/);
  });

  it('A4-FR3-001 · empty Dashboard panels say what is missing and offer one action', () => {
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toMatch(/\{ label: 'Set a budget', onClick: openAddBudget \}/);
    expect(dash).toMatch(/message="Nothing logged yet\." action=\{\{ label: '\+ Add your first expense'/);
  });

  it('A4-D1-D2-001 · phones get "What to look at" (top two insights, See all); every panel says "View all"', () => {
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toMatch(/<div className="sm:hidden" data-testid="dashboard-look-at">/);
    expect(dash).toMatch(/insights\.slice\(0, 2\)/);
    expect(dash).not.toMatch(/View All|font-mono text-\[0\.6rem\] tracking-wider uppercase text-coral/);
    expect(read('constants.ts')).toMatch(/'view-all':'View all',/);
  });

  it('A4-ON3-001 · "I\'ll add bills later" passes the bills step; the reveal shows pay only', () => {
    const ob = read('pages/Onboarding.tsx');
    expect(ob).toMatch(/I&apos;ll add bills later/);
    expect(ob).toMatch(/bills: billsLater \? \[\] : bills,/);
    expect(ob).toMatch(/fixedTotal: billsLater \? 0 : fixedTotal,\n\s*billsLater,/);
    expect(ob).toMatch(/label="Monthly pay"/);
  });
});
