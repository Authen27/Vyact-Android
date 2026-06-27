import { useEffect } from 'react';
import { useStore } from '../../store';
import { syncWidgets } from '../../lib/widgets';

// Pushes today's spend/income + budget-% to the native home-screen widgets
// whenever the relevant store data changes (debounced). Renders nothing; no-op
// on web (syncWidgets guards on isNative).
export default function WidgetSync() {
  const transactions = useStore(s => s.transactions);
  const budgets = useStore(s => s.budgets);
  const budgetAllocations = useStore(s => s.budgetAllocations);
  const households = useStore(s => s.households);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const baseCurrency = useStore(s => s.profile.baseCurrency);
  const rates = useStore(s => s.rates);

  useEffect(() => {
    const t = setTimeout(() => {
      void syncWidgets({ transactions, budgets, budgetAllocations, households, currentHouseholdId, baseCurrency, rates });
    }, 400);
    return () => clearTimeout(t);
  }, [transactions, budgets, budgetAllocations, households, currentHouseholdId, baseCurrency, rates]);

  return null;
}
