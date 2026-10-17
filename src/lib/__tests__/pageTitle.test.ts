// v10.56.0 (B3) — every app route names itself in the document title; brand and category close it.
import { describe, expect, it } from 'vitest';
import { APP_TITLE, titleFor } from '../pageTitle';

describe('page titles', () => {
  it('CON-UNIT-TITLE-001 · routes, auth steps and nested form routes get their own title; unknown paths fall back to the brand', () => {
    expect(APP_TITLE).toBe('Vyact — Family budget app');
    expect(titleFor('/auth/sign-up')).toBe('Sign up · Vyact — Family budget app');
    expect(titleFor('/dashboard')).toBe('Dashboard · Vyact — Family budget app');
    expect(titleFor('/transactions/new')).toBe('Transactions · Vyact — Family budget app');
    expect(titleFor('/chat')).toBe('Pip · Vyact — Family budget app');
    expect(titleFor('/somewhere-else')).toBe(APP_TITLE);
    expect(titleFor('/auth/unknown')).toBe(APP_TITLE);
  });
});
