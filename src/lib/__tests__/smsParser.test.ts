// Bank-message detection (Android sideload build). The fixture file is shared with the Java parser
// (native/tools/SmsParityCheck.java, run in CI), so a rule can only change in both places at once.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSms, smsSeed, type SmsDetection } from '../sms/parser';

const rows = readFileSync(resolve(__dirname, '../../../native/sms-fixtures.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter(l => l && !l.startsWith('#'))
  .map(l => { const [sender, body, expected] = l.split('\t'); return { sender, body, expected }; });

const show = (d: SmsDetection | null) => (d ? `${d.direction}|${d.amountText}|${d.currency}|${d.counterparty ?? ''}` : '-');

describe('SMS detection — shared fixtures', () => {
  it('has fixtures', () => expect(rows.length).toBeGreaterThan(30));
  for (const r of rows) {
    it(`${r.sender}: ${r.body.slice(0, 60)}`, () => {
      expect(show(parseSms(r.sender, r.body))).toBe(r.expected);
    });
  }
});

describe('SMS detection — seed for the Add-transaction form', () => {
  const at = new Date(2026, 9, 17, 14, 30).getTime();
  const spend = parseSms('CHASE', 'Chase: You spent $12.50 at STARBUCKS on 10/17 with card ending 1234.')!;

  it('pre-fills a spend in the household currency', () => {
    const s = smsSeed(spend, { baseCurrency: 'USD', receivedAt: at });
    expect(s).toMatchObject({ type: 'expense', amount: 12.5, description: 'STARBUCKS', date: '2026-10-17', category: 'food' });
    expect(s.note).toBeUndefined();
  });

  it('never pre-fills an amount that is in another currency', () => {
    const s = smsSeed(spend, { baseCurrency: 'INR', receivedAt: at });
    expect(s.amount).toBeUndefined();
    expect(s.note).toContain('USD 12.50');
    expect(s.note).toContain('INR');
  });

  it('seeds income for a credit, with no category guess', () => {
    const pay = parseSms('ICICIB', 'Acct XX123 credited with INR 85,000.00 on 01-Oct-26. Info: SALARY OCT. Avl Bal INR 90,000.00')!;
    const s = smsSeed(pay, { baseCurrency: 'INR', receivedAt: at });
    expect(s).toMatchObject({ type: 'income', amount: 85000, description: 'SALARY OCT' });
    expect(s.category).toBeUndefined();
  });

  it('seeds a card-bill payment as a transfer — never spending', () => {
    const bill = parseSms('HDFCBK', 'Rs 15,000.00 debited from a/c XX1234 towards credit card XX4321 payment')!;
    expect(bill.maybeTransfer).toBe(true);
    const s = smsSeed(bill, { baseCurrency: 'INR', receivedAt: at, sender: 'HDFCBK' });
    expect(s.type).toBe('transfer');
    expect(s.category).toBeUndefined();
  });

  it('falls back to the sender id for the description and never copies the raw message', () => {
    const d = parseSms('SBIUPI', 'Rs 250.00 debited. Avl Bal Rs 12,000.00 as on 17-10')!;
    const s = smsSeed(d, { baseCurrency: 'INR', receivedAt: at, sender: 'AX-SBIUPI' });
    expect(s.description).toBe('SBIUPI');
    expect(JSON.stringify(s)).not.toContain('Avl Bal');
  });

  it('ignores a message from an ordinary phone number', () => {
    expect(parseSms('+91 98765 43210', 'Rs 500 debited from your account')).toBeNull();
  });
});
