import { describe, expect, it } from 'vitest';
import { INTENTS, classifyIntent, intentExample } from '../askVyactIntents';
import { parse } from '../askVyactParser';

describe('Ask examples and shortcut contracts', () => {
  it('offers a real example or an explicit form-only hint for every action', () => {
    expect(new Set(INTENTS.map(intent => intent.id)).size).toBe(INTENTS.length);
    for (const intent of INTENTS) {
      expect(intentExample(intent) || intent.inputHint).toBeTruthy();
      expect(intent.action).toBeDefined();
      expect(intent.secondary).toBeUndefined();
    }
  });

  it('maps transaction and decision examples to supported intent vocabulary', () => {
    const expected = {
      'add-expense': 'capture.expense', 'add-income': 'capture.income',
      'add-transfer': 'capture.transfer', 'add-investment': 'capture.investment',
      'spend-month': 'interpret.lookup', health: 'interpret.status', 'net-worth': 'interpret.status',
      'budgets-risk': 'interpret.budgets', 'top-categories': 'interpret.lookup', 'upcoming-bills': 'interpret.bills',
      emergency: 'forecast.runway', debts: 'interpret.debts', affordability: 'forecast.affordability', 'cut-back': 'forecast.prescriptive',
    };
    for (const [id, intentId] of Object.entries(expected)) {
      const example = intentExample(INTENTS.find(intent => intent.id === id)!);
      expect(classifyIntent(parse(example!)).id, id).toBe(intentId);
    }
  });

  it('does not invent typed creation commands or categories for neutral movements', () => {
    for (const id of ['add-budget', 'add-debt', 'add-asset']) {
      const intent = INTENTS.find(row => row.id === id)!;
      expect(intentExample(intent)).toBeUndefined();
      expect(intent.action?.kind).toBe('open-modal');
      expect(intent.inputHint).toContain('Form');
    }
    for (const id of ['add-transfer', 'add-investment']) {
      const action = INTENTS.find(row => row.id === id)!.action!;
      expect(action.kind === 'open-modal' && action.seed?.category).toBe('');
    }
  });
});