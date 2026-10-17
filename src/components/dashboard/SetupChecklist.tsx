// Aurora 4.0 FR1 — "Finish setting up" on the first Dashboard after onboarding (lib/setupChecklist.ts
// holds the rules). Each step links to where it is done; the card goes once every step is done or the
// person hides it.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, X } from 'lucide-react';
import { useStore } from '../../store';
import { getBaseline, getOnboarding } from '../../lib/onboardingState';
import { normalizeHouseholdType } from '../../lib/householdTypes';
import { readSetupFlags, setupSteps, setupVisible, writeSetupFlag, type SetupAction } from '../../lib/setupChecklist';

export default function SetupChecklist() {
  const navigate = useNavigate();
  const householdId = useStore(s => s.currentHouseholdId);
  const households = useStore(s => s.households);
  const schedules = useStore(s => s.recurringSchedules);
  const accounts = useStore(s => s.accounts);
  const transactions = useStore(s => s.transactions);
  const members = useStore(s => s.members);
  const invitations = useStore(s => s.householdInvitations);
  const openAddTxn = useStore(s => s.openAddTxn);
  const [hidden, setHidden] = useState(() => !!readSetupFlags(householdId).hidden);

  const onboarding = getOnboarding(householdId);
  const completed = onboarding.state === 'completed';

  const steps = useMemo(() => {
    const since = (onboarding.completedAt ?? '').slice(0, 10);
    const expenseSchedules = schedules.filter(s => s.active !== false && s.transactionTemplate?.type === 'expense');
    const waiting = expenseSchedules.filter(s => !s.autoConfirm && !s.lastGenerated)
      .map(s => s.transactionTemplate.description || 'A bill');
    const loggedDays = new Set(transactions
      .filter(t => (t.type === 'expense' || t.type === 'income') && (!since || t.date >= since))
      .map(t => t.date)).size;
    const type = normalizeHouseholdType(households.find(h => h.id === householdId)?.type);
    return setupSteps({
      onboardingCompleted: completed,
      billsMissing: !!getBaseline(householdId)?.billsLater && expenseSchedules.length === 0,
      waitingBills: waiting,
      reviewedBills: !!readSetupFlags(householdId).reviewedBills,
      payingAccounts: accounts.filter(a => !a.isArchived && (a.kind === 'bank' || a.kind === 'credit_card')).length,
      loggedDays,
      householdType: type,
      othersInvited: members.length > 1 || invitations.length > 0,
    });
  }, [schedules, transactions, accounts, members, invitations, households, householdId, completed, onboarding.completedAt]);

  if (!setupVisible(steps, completed, hidden)) return null;

  const done = steps.filter(s => s.done).length;
  const go = (action: SetupAction) => {
    if (action === 'addTxn') openAddTxn({ type: 'expense' });
    else navigate(`/${action}`);
  };
  const hide = () => { writeSetupFlag(householdId, 'hidden'); setHidden(true); };

  return (
    <section aria-label="Finish setting up" data-testid="setup-checklist" className="card-raised p-[18px]">
      <div className="flex justify-between items-baseline gap-3">
        <h2 className="font-display font-medium text-[17px] text-ink">Finish setting up</h2>
        <div className="flex items-center gap-1">
          <span className="ui-label">{done} of {steps.length} done</span>
          <button type="button" onClick={hide} aria-label="Hide the setup checklist" title="Hide"
            className="min-w-[44px] min-h-[44px] -my-3 -mr-3 flex items-center justify-center text-ink-dim hover:text-ink rounded-full">
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>
      <div className="trough h-1.5 mt-2.5 mb-1.5" role="img" aria-label={`${done} of ${steps.length} steps done`}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%`, background: 'hsl(var(--sage))' }} />
      </div>
      <ul>
        {steps.map((step, i) => (
          <li key={step.id} className={i ? 'border-t border-line' : ''}>
            <button type="button" onClick={() => go(step.action)} disabled={step.done}
              className={`w-full flex items-center gap-3 py-2.5 min-h-[52px] text-left ${step.done ? 'opacity-60 cursor-default' : 'hover:brightness-110'}`}>
              <span aria-hidden className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center"
                style={step.done ? { background: 'hsl(var(--sage))', color: '#0A1215' } : { border: '1.5px solid hsl(var(--line2))' }}>
                {step.done && <Check size={13} strokeWidth={3} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-[14px] font-medium text-ink ${step.done ? 'line-through' : ''}`}>{step.title}</span>
                <span className="block text-[12.5px] text-ink-dim">{step.detail}</span>
              </span>
              {!step.done && <ChevronRight size={14} className="text-ink-dim flex-shrink-0" aria-hidden />}
              <span className="sr-only">{step.done ? '(done)' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
