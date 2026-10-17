// Aurora 4.0 · A5 Plan and Track pages (v10.104.0) — T1, T2, S1–S3, SP4, FIT1, BG1, BG2, R1, R2, FIT2,
// DB1, DB2, DBT3, AC1, AC2, ACM1, NW1–NW3, RP2, TERM1, and the X1/X9 sweep on each page touched.
// Each case is named after its change code.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import OverflowMenu from '../../components/ui/OverflowMenu';
import CategoryTile from '../../components/ui/CategoryTile';

vi.stubGlobal('React', React);
const src = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf8').replace(/\r\n/g, '\n');
const PAGES = ['Transactions', 'Splits', 'Budgets', 'Recurring', 'Debts', 'Accounts', 'NetWorth', 'Reports'];

describe('A5 · Plan and Track pages', () => {
  it('A5-S2-001 · the ⋯ More menu: a labelled menu button, closed until pressed', () => {
    const out = renderToStaticMarkup(<OverflowMenu ariaLabel="More actions for Car loan" items={[{ label: 'Edit loan', onSelect: () => {} }]} />);
    expect(out).toMatch(/aria-haspopup="menu"/);
    expect(out).toMatch(/aria-expanded="false"/);
    expect(out).toMatch(/aria-label="More actions for Car loan"/);
    expect(out).toMatch(/> More<\/button>/);
    expect(out).not.toMatch(/role="menu"/);
    expect(renderToStaticMarkup(<OverflowMenu items={[]} />)).toBe('');
    const menu = read('components/ui/OverflowMenu.tsx');
    expect(menu).toMatch(/role="menuitem"/);
    expect(menu).toMatch(/min-h-\[44px\]/);
    expect(menu).toMatch(/e\.key === 'Escape'/);
  });

  it('A5-S1-S3-001 · Splits: raised hero, Settle all is the one primary, the rest in ⋯, Mark paid is a ghost', () => {
    const s = read('pages/Splits.tsx');
    expect(s).toMatch(/<div className="card-raised p-5 mb-5 overflow-hidden" data-testid="splits-hero">/);
    expect(s).toMatch(/<button className="btn-primary" onClick=\{\(\) => markAllPaid\(txn\.id\)\}>/);
    expect(s).toMatch(/<OverflowMenu ariaLabel=[^]*?label: 'Edit'[^]*?label: 'Close split'[^]*?label: 'Delete', danger: true/);
    expect(s).toMatch(/<button className="btn-ghost" onClick=\{\(\) => markPaid\(txn\.id, p\.name\)\}>\s*Mark paid/);
    // SP4 — no bare ▾/▴ marks; one link opens who owes what.
    expect(s).not.toMatch(/[▾▴]/);
    expect(s).toMatch(/'See who owes what →'/);
    // FIT1 — date · people under the name; the amount alone on the right.
    expect(s).toMatch(/\{formatDate\(txn\.date, profile\.dateFormat\)\} · \{split\.participants\.length\}/);
  });

  it('A5-T1-T2-001 · Transactions: no separate count/net strip; the month pill is 12px with entries', () => {
    const s = read('pages/Transactions.tsx');
    expect(s).not.toMatch(/'transaction' : 'transactions'/);
    expect(s).toMatch(/className="sticky top-0 z-10 flex items-center gap-2\.5 px-3\.5 py-2\.5 rounded-r2"/);
    expect(s).toMatch(/'entry' : 'entries'/);
  });

  it('A5-BG1-BG2-001 · Budgets: every bar is the inset trough; the hero has Edit and Delete like the cards', () => {
    const s = read('pages/Budgets.tsx');
    expect(s).not.toMatch(/bg-bg3 rounded-full/);
    expect(s.match(/className="trough h-/g)?.length).toBeGreaterThanOrEqual(4);
    expect(s).not.toMatch(/edit ▸/);
    expect(s).toMatch(/aria-label=\{`Edit the \$\{budgetTitle\(b\)\} budget`\}/);
    expect(s).toMatch(/aria-label=\{`Delete the \$\{budgetTitle\(b\)\} budget`\}/);
  });

  it('A5-R1-R2-FIT2-001 · Recurring: shared category tile, Edit before Delete, phones open the editor with Delete', () => {
    const tile = renderToStaticMarkup(<CategoryTile icon="🏠" color="#c08040" />);
    expect(tile).toMatch(/width:34px;height:34px/);
    expect(tile).toMatch(/color-mix\(in srgb, #c08040 15%, transparent\)/);
    expect(tile).toMatch(/box-shadow:var\(--neu-sm\)/);
    const s = read('pages/Recurring.tsx');
    expect(s).toMatch(/<CategoryTile icon=\{cat\.icon\} color=\{cat\.color\} \/>/);
    expect(s).toMatch(/aria-label="Edit schedule"[^]*?aria-label="Delete schedule"/);
    expect(s).toMatch(/className="sm:hidden absolute inset-0 z-\[1\]"/);
    expect(s).toMatch(/if \(await deleteSchedule\(editing\)\)/);
    expect(s).toMatch(/Delete schedule\s*<\/button>/);
  });

  it('A5-DB1-DB2-DBT3-001 · Debts: left-aligned summary, Pay and Schedule in view, the rest in ⋯, ring says paid off', () => {
    const s = read('pages/Debts.tsx');
    expect(s).toMatch(/data-testid="debts-summary"/);
    expect(s).toMatch(/card-raised p-4 text-left min-w-0 \$\{s\.wide \? 'col-span-2 sm:col-span-1' : ''\}/);
    expect(s).toMatch(/<div className="ui-label">\{s\.label\}<\/div>\s*<div className=\{`num text-xl/);
    expect(s).toMatch(/<button className="btn-primary" onClick=\{onPay\}>/);
    expect(s).toMatch(/<OverflowMenu ariaLabel=\{`More actions for \$\{d\.name\}`\}[^]*?'Payments'[^]*?'Undo last payment'[^]*?'Edit loan'[^]*?'Mark paid off'/);
    expect(s).not.toMatch(/by \{clears\}/);
    expect(s).toMatch(/>paid off<\/div>/);
  });

  it('A5-AC1-AC2-ACM1-001 · Accounts: Cash is a card in its own group, the aside is attention only, phones show card usage', () => {
    const s = read('pages/Accounts.tsx');
    expect(s).toMatch(/<section aria-label="Cash in Hand">\s*<GroupBar icon="💵" name="Cash" tone="sage" \/>[^]*?\{view\.cash\.map\(row\)\}/);
    expect(s).not.toMatch(/border-y border-line/);
    expect(s).not.toMatch(/Household currency/);           // AC2: lives in Settings
    expect(s).toMatch(/Needs your attention/);
    expect(s).toContain("{Math.round(figures.utilisation * 100)}% of limit used{due ? ` · due ${due}` : ''}");
    // The bar stops at full; the percentage is not capped.
    expect(s).toMatch(/width: `\$\{Math\.min\(100, figures\.utilisation \* 100\)\}%`/);
    expect(s).not.toMatch(/Math\.min\(100, Math\.round/);
  });

  it('A5-TERM1-001 · "Available cash" is the Accounts figure; Net Worth and Reports say "Liquid assets"', () => {
    expect(read('pages/Accounts.tsx')).toMatch(/label="Available cash"/);
    expect(read('pages/Accounts.tsx')).not.toMatch(/Cash available/);
    expect(read('pages/NetWorth.tsx')).toMatch(/label: 'Liquid assets'/);
    expect(read('pages/NetWorth.tsx')).not.toMatch(/Money you can reach/);
    expect(read('pages/Reports.tsx')).toMatch(/label: 'Liquid assets', value: position\.liquidAssets/);
  });

  it('A5-NW1-NW3-001 · Net Worth: waterfall labels under the bars on phones, borderless rows, sentence-case ratios', () => {
    const s = read('pages/NetWorth.tsx');
    expect(s).toMatch(/className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2"/);
    expect(s).toMatch(/text-\[12px\] text-ink-mid sm:whitespace-nowrap/);
    expect(s).not.toMatch(/bg-bg border border-line rounded-lg/);
    expect(s.match(/className="tile px-4 py-3/g)).toHaveLength(3);
    expect(s).toMatch(/<div className="text-\[12px\] leading-snug text-ink-dim">\{r\.sub\}<\/div>/);
    for (const sub of ['Cash and savings you could use today', 'Share of what you own that is borrowed', 'No income recorded this month']) {
      expect(s).toContain(`'${sub}'`);
    }
  });

  it('A5-RP2-001 · Reports: the household position is one row with a link to Net Worth', () => {
    const s = read('pages/Reports.tsx');
    expect(s).toMatch(/<section aria-label="Household position"\s+className="card-raised/);
    expect(s).toMatch(/<h2 className="ui-label[^"]*">Household position<\/h2>/);
    expect(s).not.toMatch(/label: 'Assets', value|This month · \{currentMk\}|Tracked minimum debt payments/);
    expect(s).toMatch(/<section aria-label="Essential-spend runway"/);
    expect(s).toMatch(/<Link to="\/networth" className="empty-link[^"]*">Net Worth →<\/Link>/);
  });

  it('A5-X1-X9-001 · the eight pages use sans labels and no text under 11px', () => {
    for (const page of PAGES) {
      const s = read(`pages/${page}.tsx`);
      expect(s, page).toMatch(/className="ui-pilot/);
      expect(s, page).not.toMatch(/font-mono[^"`]*uppercase|uppercase[^"`]*font-mono/);
      expect(s, page).not.toMatch(/text-\[(?:[0-9]|10)(?:\.\d+)?px\]/);
      expect(s, page).not.toMatch(/text-\[0\.(?:[0-5]\d*|6[0-7]?)rem\]/);
    }
  });
});
