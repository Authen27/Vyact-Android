// FU-001..011 — v10.109.0 (owner decisions 16 Oct 2026): Track E's follow-ups.
//   • R-1: an EMI is set up on its LOAN, never as a Recurring schedule (which E6a hides, so a drafted EMI
//     schedule used to vanish). Pip and Recurring hand the request to the loan form, with "Record each EMI
//     automatically" ON; an existing loan is named, with a "Record automatically" chip when it is off.
//   • Pulse is archived: no screen, Pip answer or summary carries a Pulse score.
//   • The demo budget plans the mortgage and the loan EMIs.
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolve, runAssistant, quickReply, LlmBackend, type AssistantContext } from '../askVyactBackend';
import { buildSafeSummary } from '../aiSummary';
import { classifyIntent } from '../aiUsage';
import { renderForWhatsApp } from '../serverEngine';
import { buildSeed } from '../seed';
import { budgetProgress } from '../budgetProgress';
import type { ModelCall } from '../askVyactLlm';
import type { IntentResult } from '../askVyactIntents';
import type { Debt, Profile, Transaction } from '../../types';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('../appNavigation', () => ({ appNavigate: navigate }));
vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));

const ROOT = resolvePath(__dirname, '../../../..');
const NOW = '2026-10-16';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${NOW}T06:00:00Z`)); });
afterAll(() => { vi.useRealTimers(); });

const profile = { baseCurrency: 'INR', household: 'family', language: 'en' } as unknown as Profile;
const loan = (p: Partial<Debt> = {}): Debt => ({
  id: 'car', type: 'auto_loan', name: 'Car loan', principal: 600_000, currentBalance: 420_000, interestRate: 9,
  minimumPayment: 15_000, currency: 'INR', direction: 'owed_by_me', dueDate: '2026-11-05', firstEmiDate: '2025-06-05', ...p,
} as Debt);
function ctx(debts: Debt[] = [], transactions: Transaction[] = []): AssistantContext {
  const summary = buildSafeSummary(transactions, [], [], debts, [], profile, { INR: 1 });
  return { summary, transactions, budgets: [], goals: [], debts, assets: [], profile, rates: { INR: 1 }, baseCurrency: 'INR',
    accounts: [{ id: 'hdfc', name: 'HDFC', kind: 'bank' }] } as unknown as AssistantContext;
}
const recurringIntent = (text: string, entities: Record<string, unknown> = {}): IntentResult =>
  ({ id: 'capture.recurring', bucket: 'capture', confidence: 0.9, entities: { text, ...entities } }) as IntentResult;
const classifyOnly = (entities: Record<string, unknown>) => vi.fn<ModelCall>(async () =>
  JSON.stringify({ id: 'capture.recurring', entities, confidence: 0.9 }));

describe('R-1 — an EMI is set up on its loan, never as a schedule', () => {
  it('FU-001 · no loan yet: Pip opens Add loan pre-filled, Record automatically ON, with no phrase call', async () => {
    const call = classifyOnly({ amount: 15_000, merchant: 'car emi', frequency: 'monthly', category: 'loan_emi' });
    const turn = await runAssistant('set up my car EMI 15000 monthly on the 5th', ctx(), new LlmBackend(call), 0);
    expect(call).toHaveBeenCalledTimes(1);                                     // classify only, no phrase
    expect(turn.recurringSeed).toBeUndefined();                                // never a schedule
    expect(turn.loanSeed).toEqual({ mode: 'new', name: 'Car loan', emi: 15_000, nextEmiDate: '2026-11-05', autoRecord: true });
    expect(turn.reply).toMatch(/opened Add loan for Car loan with ₹15,000 a month on the 5th and Record automatically on/);
  });

  it('FU-002 · a matching loan is named, with a "Record automatically" chip when that is off; none when it is on', () => {
    const off = resolve(recurringIntent('set up my car emi'), ctx([loan()]));
    expect(off).toMatchObject({ kind: 'capture', outcome: 'loan_handoff' });
    expect(off.loanSeed).toBeUndefined();
    expect(String(off.vars.message)).toMatch(/Car loan EMI \(₹15,000, next on 5 Nov\) is paid by the loan/);
    expect(off.chips).toEqual([{ label: 'Record Car loan automatically', prompt: 'record Car loan emi automatically' }]);
    const on = resolve(recurringIntent('set up my car emi'), ctx([loan({ autoRecord: true, fundingAccountId: 'hdfc' })]));
    expect(String(on.vars.message)).toMatch(/already set up from the loan: Vyact records ₹15,000 on its date, next on 5 Nov from HDFC/);
    expect(on.chips).toBeUndefined();
  });

  it('FU-003 · the chip opens that loan with the switch on, answered without any model', async () => {
    const q = quickReply('record Car loan emi automatically', ctx([loan()]));
    expect(q?.loanSeed).toEqual({ mode: 'edit', debtId: 'car', autoRecord: true });
    // runAssistant answers it even with no model configured at all.
    const turn = await runAssistant('record Car loan emi automatically', ctx([loan()]), null, 0);
    expect(turn.loanSeed).toEqual({ mode: 'edit', debtId: 'car', autoRecord: true });
    expect(turn.intentId).toBe('meta.assistant');
  });

  it('FU-004 · two loans: a nameless request lists them; a named one picks it; an unknown name opens Add loan for it', () => {
    const debts = [loan(), loan({ id: 'home', name: 'Home loan', type: 'mortgage', minimumPayment: 32_000, dueDate: '2026-11-10' })];
    const nameless = resolve(recurringIntent('set up my emi'), ctx(debts));
    expect(String(nameless.vars.message)).toMatch(/Car loan ₹15,000, Home loan ₹32,000/);
    expect(nameless.chips?.map(c => c.prompt)).toEqual(['record Car loan emi automatically', 'record Home loan emi automatically']);
    expect(String(resolve(recurringIntent('home loan emi'), ctx(debts)).vars.message)).toMatch(/Home loan EMI \(₹32,000/);
    expect(resolve(recurringIntent('bike emi 4000', { amount: 4000 }), ctx(debts)).loanSeed)
      .toMatchObject({ mode: 'new', name: 'Bike loan', emi: 4000, autoRecord: true });
  });

  it('FU-005 · a non-EMI bill still drafts a schedule, and a model-supplied EMI amount is not used', () => {
    expect(resolve(recurringIntent('netflix 649 every month', { amount: 649, merchant: 'netflix' }), ctx()).recurringSeed)
      .toMatchObject({ category: 'entertainment', amount: 649 });
    // The words state no amount: the loan form gets none (W5: only a stated amount counts).
    expect(resolve(recurringIntent('set up my car emi', { amount: 99_999 }), ctx()).loanSeed).not.toHaveProperty('emi');
  });

  it('FU-006 · on WhatsApp the hand-off says where to do it in the app, with no chips', () => {
    const base = { reply: 'x', bucket: 'capture', intentId: 'capture.recurring', clarify: false, allowedFigures: [] };
    expect(renderForWhatsApp({ ...base, loanSeed: { mode: 'new', name: 'Car loan', autoRecord: true } } as never, 'https://vyact.app'))
      .toEqual({ text: expect.stringMatching(/Debts › Add loan, with Record automatically on.*https:\/\/vyact\.app\/debts$/), chipPrompts: [] });
    expect(renderForWhatsApp({ ...base, loanSeed: { mode: 'edit', debtId: 'car', autoRecord: true } } as never, 'https://vyact.app').text)
      .toMatch(/Recurring › Loan EMIs/);
  });

  it('FU-007 · the store sends only a real seed: a click event passed by a button opens a plain form', async () => {
    const { useStore } = await import('../../store');
    navigate.mockClear();
    useStore.getState().openAddDebt({ type: 'click', target: {} } as never);
    useStore.getState().openAddDebt({ mode: 'new', name: 'Car loan', emi: 15_000, autoRecord: true });
    useStore.getState().openEditDebt(loan(), { mode: 'edit', debtId: 'car', autoRecord: true });
    expect(navigate.mock.calls).toEqual([
      ['/debts/new', undefined],
      ['/debts/new', { state: { loanSeed: { mode: 'new', name: 'Car loan', emi: 15_000, autoRecord: true } } }],
      ['/debts/car/edit', { state: { loanSeed: { mode: 'edit', debtId: 'car', autoRecord: true } } }],
    ]);
  });

  it('FU-008 · Recurring hands an EMI to the loan; the loan form starts with Record automatically on', () => {
    const read = (p: string) => readFileSync(resolvePath(ROOT, p), 'utf8');
    const recurring = read('react/src/pages/Recurring.tsx');
    expect(recurring).toMatch(/if \(type === 'expense' && category === 'loan_emi'\) \{[\s\S]*?openAddDebt\(\{ mode: 'new'/);
    expect(recurring).toMatch(/data-testid="add-loan-emi"/);
    expect(recurring).toMatch(/openEditDebt\(row\.debt, \{ mode: 'edit', debtId: row\.debt\.id, autoRecord: true \}\)/);
    const form = read('react/src/components/debts/DebtFormModal.tsx');
    expect(form).toMatch(/autoRecord: seed\?\.mode === 'edit' \? true : !!initial\.autoRecord/);
    expect(form).toMatch(/\} else if \(seed\?\.mode === 'new'\) \{[\s\S]*?autoRecord: true,/);
    // "Car loan" → Auto Loan needs real word boundaries; a lost backslash once left a backspace in this regex.
    expect(form).toContain(String.raw`/\b(car|auto|vehicle|bike|scooter)\b/`);
    expect([...form].filter(ch => { const c = ch.charCodeAt(0); return c < 32 && c !== 9 && c !== 10 && c !== 13; })).toEqual([]);
    const chat = read('react/src/pages/Chat.tsx');
    expect(chat).toMatch(/if \(loanSeed\.mode === 'new'\) openAddDebt\(loanSeed\);/);
  });
});

describe('Pulse is archived (owner, 16 Oct 2026)', () => {
  it('FU-009 · "how am I doing?" is answered from the position: no Pulse score in the facts, the headline or the summary', () => {
    const txns = [
      { id: 'i', type: 'income', amount: 100_000, currency: 'INR', date: '2026-10-01', description: '', category: 'salary' },
      { id: 'e', type: 'expense', amount: 40_000, currency: 'INR', date: '2026-10-03', description: '', category: 'groceries' },
    ] as Transaction[];
    const c = ctx([], txns);
    expect(c.summary).not.toHaveProperty('pulseScore');
    const r = resolve({ id: 'interpret.status', bucket: 'interpret', confidence: 0.9, entities: { text: 'how am i doing' } } as IntentResult, c);
    const facts = r.facts as Record<string, unknown>;
    expect(facts).not.toHaveProperty('pulse_score');
    expect(facts).not.toHaveProperty('pulse_measures');
    expect(JSON.stringify(facts)).not.toMatch(/pulse/i);
    expect(r.vars.headline).toBe("This month you've kept 60% of what came in.");
    // Asked for by name, it is said to be retired, with the position instead.
    const named = resolve({ id: 'interpret.status', bucket: 'interpret', confidence: 0.9, entities: { text: "what's my pulse score" } } as IntentResult, c);
    expect((named.facts as Record<string, string>).pulse_score).toMatch(/^retired/);
  });

  it('FU-010 · metering labels the question "status", and no screen or prompt rule keeps the Pulse fields', () => {
    expect(classifyIntent('how am I doing?')).toBe('status');
    const read = (p: string) => readFileSync(resolvePath(ROOT, p), 'utf8');
    expect(read('react/src/config/features.ts')).not.toMatch(/showPulse/);
    expect(read('react/src/pages/Dashboard.tsx')).not.toMatch(/PulseBlock|selectPulse|pulseAdvice/);
    expect(read('react/src/lib/askVyactLlm.ts')).not.toMatch(/pulse_measures/);
    expect(read('admin/src/pages/Dashboard.tsx')).not.toMatch(/Pulse improved/);
  });
});

describe('the demo plans its mortgage and EMIs (owner, 16 Oct 2026)', () => {
  it('FU-011 · the demo month has Rent / Mortgage and Loan / EMI lines, so the mortgage is never "not planned"', () => {
    const s = buildSeed(new Date(`${NOW}T06:00:00Z`));
    const month = s.budgets[0];
    const lines = s.budgetAllocations.filter(a => a.budgetId === month.id).map(a => a.category);
    expect(lines).toEqual(expect.arrayContaining(['rent_mortgage', 'loan_emi']));
    const p = budgetProgress(month, s.budgetAllocations, s.transactions, { baseCurrency: s.profile.baseCurrency, rates: s.exchangeRates });
    expect(p.notPlanned.map(l => l.category)).not.toContain('rent_mortgage');
    expect(p.limit).toBe(4800);
    expect(p.unallocated).toBe(115);
  });
});
