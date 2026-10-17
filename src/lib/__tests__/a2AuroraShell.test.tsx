// Aurora 4.0 · A2 shell (v10.86.0) — one page header, the page's own + in the phone header, the
// desktop floating + as a menu of the other things to add, and the household switch in the avatar
// (PH1 B′, X3, X4, HDR1, HDR2, IN1, HH4, FIT3). Each case is named after its change code.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PageHead from '../../components/ui/PageHead';

vi.stubGlobal('React', React);
const src = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf8').replace(/\r\n/g, '\n');

const APP_PAGES = ['Dashboard', 'Transactions', 'Splits', 'Budgets', 'Recurring', 'Debts', 'Accounts', 'NetWorth',
  'Reports', 'Insights', 'Chat', 'Households', 'Settings', 'Help'];

describe('A2 · Aurora 4.0 shell', () => {
  it('A2-PH1-001 · every app page uses the one PageHead; no hand-rolled h1 blocks remain', () => {
    for (const page of APP_PAGES) {
      const s = read(`pages/${page}.tsx`);
      expect(s, page).toMatch(/import PageHead from '\.\.\/components\/ui\/PageHead';/);
      expect(s, page).toMatch(/<PageHead\b/);
      expect(s, page).not.toMatch(/<h1 className="display-italic text-4xl/);
    }
  });

  it('A2-X3-001 · phones: the title is visually hidden but stays the page h1; without controls the header takes no space', () => {
    const plain = renderToStaticMarkup(<PageHead title="Debts" action={{ label: '+ Add Loan', onClick: () => {} }} />);
    expect(plain).toMatch(/<h1 class="display-italic text-4xl text-ink">Debts<\/h1>/);
    expect(plain).toMatch(/data-testid="page-head" class="[^"]*max-sm:sr-only/);
    // X4 / PH1 desktop: the page's own button, centred on the title; hidden on phones (the header + does it).
    expect(plain).toMatch(/class="flex justify-between items-center/);
    expect(plain).toMatch(/<button type="button" class="btn-primary flex-shrink-0 max-sm:hidden">\+ Add Loan<\/button>/);

    const withAside = renderToStaticMarkup(<PageHead title="Insights" subtitle="Your review" aside={<span>tabs</span>} />);
    expect(withAside).not.toMatch(/data-testid="page-head" class="[^"]*max-sm:sr-only/);   // the controls stay
    expect(withAside).toMatch(/<div class="min-w-0 max-sm:sr-only"><h1/);                   // the title still hides
    expect(withAside).toMatch(/<p class="ui-label mt-1\.5">Your review<\/p>/);              // X1: sentence-case subtitle
  });

  it('A2-PH1-002 · the phone header shows the page action as a small outlined +; Transactions and Dashboard leave it to the tab bar', () => {
    const header = read('components/layout/MobileHeader.tsx');
    expect(header).toMatch(/const plus = pageAction && pageAction\.headerPlus !== false \? pageAction : null;/);
    expect(header).toMatch(/aria-label=\{plus\.label\}/);
    expect(header).toMatch(/w-\[38px\] h-\[38px\] rounded-full/);
    expect(read('pages/Transactions.tsx')).toMatch(/entity: 'transaction', headerPlus: false/);
    expect(read('pages/Dashboard.tsx')).toMatch(/entity: 'transaction', headerPlus: false/);
    expect(read('pages/Debts.tsx')).toMatch(/action=\{\{ label: '\+ Add Loan', entity: 'debt'/);
  });

  it('A2-HH4-001 · Households: the header + creates a household on phones', () => {
    expect(read('pages/Households.tsx')).toMatch(/action=\{\{ label: 'Create Household', icon: true, entity: 'household', onClick: \(\) => setCreateOpen\(true\) \}\}/);
  });

  it('A2-HDR-001 · no household chip in either header; the avatar carries a badge and its menu the switcher', () => {
    for (const f of ['components/layout/MobileHeader.tsx', 'components/layout/TopBar.tsx']) {
      const s = read(f);
      expect(s, f).not.toMatch(/Switch household/);
      expect(s, f).not.toMatch(/HouseholdSheet/);
    }
    const menu = read('components/layout/AccountMenu.tsx');
    expect(menu).toMatch(/aria-label=\{`Switch household — \$\{active\.name\}`\}/);
    expect(menu).toMatch(/onClick=\{\(\) => \{ setOpen\(false\); setHhOpen\(true\); \}\}/);
    expect(menu.match(/\{active && badge\}/g)).toHaveLength(2);   // phone avatar and desktop pill
    expect(menu.match(/<HouseholdSheet open=\{hhOpen\}/g)).toHaveLength(2);
  });

  it('A2-X4-001 · desktop floating + opens a menu of the other entities, never this page\'s own; IN1: shown on Insights', () => {
    const fab = read('components/layout/AddFab.tsx');
    expect(fab).toMatch(/const menu = items\.filter\(item => item\.entity !== pageEntity\);/);
    expect(fab).toMatch(/role="menu"/);
    expect(fab).toMatch(/onClick=\{\(\) => setOpen\(o => !o\)\}/);
    expect(fab).not.toMatch(/openAddTxn\(\);\n {2}\}/);            // a click no longer adds a transaction
    expect(fab).not.toMatch(/startsWith\('\/insights'\)/);
    expect(fab).not.toMatch(/longPress/i);
  });

  it('A2-FIT3-001 · Pip: the heading hides on phones and the toolbar stays in one row', () => {
    const chat = read('pages/Chat.tsx');
    expect(chat).toMatch(/<PageHead\s+title=\{<span className="flex items-center gap-2\.5"><MessageCircle className="text-coral" \/> Pip<\/span>\}/);
    expect(chat).toMatch(/aside=\{toolbar\}/);
  });

  it('A2-CTX-001 · the page action is registered for the shell and cleared when the page unmounts', () => {
    const ctx = read('components/layout/pageAction.ts');
    expect(ctx).toMatch(/setAction\(\{ label, entity, headerPlus, onClick: \(\) => run\.current\?\.\(\) \}\);\n {4}return \(\) => setAction\(null\);/);
    expect(read('components/layout/Layout.tsx')).toMatch(/<PageActionContext\.Provider value=\{pageActionCtx\}>/);
  });
});
