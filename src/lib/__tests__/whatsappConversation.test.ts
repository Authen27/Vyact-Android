// W3 (v10.44.0) — the short replies that continue a WhatsApp conversation.
import { describe, expect, it } from 'vitest';
import {
  isUndo, yesNo, bareAmount, parseCorrection, categoryFitsType, worthAskingAmount, duplicateQuestion,
} from '../../../../supabase/functions/_shared/whatsapp-conversation';

describe('capture conversation replies', () => {
  it('CON-UNIT-WA-C-005 · UNDO, yes/no and a bare amount are recognised only as the whole message', () => {
    for (const t of ['undo', 'UNDO', 'undo that', 'delete last', 'remove it.']) expect(isUndo(t), t).toBe(true);
    for (const t of ['undo 450', 'please undo my budget', 'delete']) expect(isUndo(t), t).toBe(false);
    expect(yesNo('1')).toBe('yes');
    expect(yesNo('Yes!')).toBe('yes');
    expect(yesNo('2')).toBe('no');
    expect(yesNo('skip')).toBe('no');
    expect(yesNo('12')).toBeNull();
    expect(bareAmount('450')).toBe(450);
    expect(bareAmount('₹1,200.50')).toBe(1200.5);
    expect(bareAmount('rs 80')).toBe(80);
    expect(bareAmount('450 lunch')).toBeNull();
    expect(bareAmount('0')).toBeNull();
  });

  it('CON-UNIT-WA-C-006 · corrections name a category; the category must fit the entry’s type', () => {
    expect(parseCorrection('no, that was groceries')).toBe('groceries');
    expect(parseCorrection('change it to fuel')).toBe('travel');
    expect(parseCorrection('actually dinner')).toBe('food_dining');
    expect(parseCorrection('that was a mistake')).toBeNull();          // no category named
    expect(parseCorrection('450 groceries')).toBeNull();
    expect(categoryFitsType('groceries', 'expense')).toBe(true);
    expect(categoryFitsType('salary', 'expense')).toBe(false);
    expect(categoryFitsType('salary', 'income')).toBe(true);
    expect(categoryFitsType('groceries', 'transfer')).toBe(false);
  });

  it('CON-UNIT-WA-C-007 · only a message naming what it was for is worth asking the amount of', () => {
    expect(worthAskingAmount('groceries hdfc')).toBe(true);
    expect(worthAskingAmount('hello there friend')).toBe(false);
    expect(worthAskingAmount('450 groceries')).toBe(false);
    expect(duplicateQuestion('₹450', 'Groceries', 1)).toMatch(/^You logged ₹450 · Groceries a minute ago\./);
  });
});
