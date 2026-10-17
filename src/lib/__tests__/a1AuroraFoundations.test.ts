// Aurora 4.0 · A1 foundations (v10.85.0) — the global design changes from
// `Vyact Redesign/Design 4.0/DESIGN_CHANGES.md` that the pages build on. Each case is named after its
// change code. Style rules are pinned by reading the files the browser reads.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { offlineMessage } from '../../components/layout/OfflineStrip';
import { needsYou } from '../notifications';

const src = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf8').replace(/\r\n/g, '\n');
function tsxFiles(dir = src): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : tsxFiles(p);
    return p.endsWith('.tsx') ? [relative(src, p).split('\\').join('/')] : [];
  });
}
/** The [data-theme="warm"] token block (Mist). */
const mistBlock = () => read('index.css').split('[data-theme="warm"] {')[1].split('\n}')[0];

describe('A1 · Aurora 4.0 foundations', () => {
  it('A1-X2-001 · three surface tiers; the bg3 + border + 8px tile is retired from the app', () => {
    const css = read('index.css');
    expect(css).toMatch(/\.card-raised \{[^}]*box-shadow: var\(--neu\);[^}]*border-radius: 18px;/);
    expect(css).toMatch(/\.well \{\s*background: var\(--well-bg\);\s*box-shadow: var\(--well-shadow\);\s*border: 1px solid var\(--well-border\);\s*border-radius: 12px;/);
    // Public pages (Landing, legal) move in A8; inputs, badges and the estimated tag are not tiles.
    const exempt = new Set(['pages/LandingView.tsx', 'pages/Privacy.tsx', 'pages/Terms.tsx', 'pages/Cookies.tsx',
      'components/ui/Input.tsx', 'components/ui/Badge.tsx', 'components/ui/EstimatedTag.tsx']);
    for (const f of tsxFiles().filter(f => !exempt.has(f))) {
      expect(read(f), f).not.toMatch(/bg-bg3 border border-line rounded-md/);
    }
  });

  it('A1-X12-001 · radii are 12 / 18 / 26: md and r1 are 12px, no arbitrary card radii remain', () => {
    const tw = read('../tailwind.config.ts');
    expect(tw).toMatch(/md: '12px'/);
    expect(tw).toMatch(/r1: '12px', r2: '12px', r3: '18px', r4: '26px'/);
    expect(read('index.css')).toMatch(/--ff-r-2: 12px;/);
    for (const f of tsxFiles()) expect(read(f), f).not.toMatch(/rounded-\[(8|9|10|11|13|15|16|20)px\]/);
  });

  it('A1-X8-001 · text on coral is the dark accent ink, never white', () => {
    for (const f of tsxFiles()) {   // Landing included since A8 (LP2)
      expect(read(f), f).not.toMatch(/bg-coral text-white/);
    }
    expect(read('pages/Reports.tsx')).not.toMatch(/text-white/);   // CON2: the Needs segment
  });

  it('A1-X10-001 · no Pulse Score, Goals stat or custom plans in the copy', () => {
    expect(read('components/transactions/TransactionFormModal.tsx')).toMatch(/Exclude from household totals and charts/);
    expect(read('components/transactions/TransactionFormModal.tsx')).not.toMatch(/Pulse Score/);
    expect(read('pages/Settings.tsx')).not.toMatch(/label: 'Goals'/);
    expect(read('pages/Budgets.tsx')).toMatch(/Month and annual plans/);
  });

  it('A1-X5-001 · one SegRail: the view switches are the shared component, active = accent tint + inset', () => {
    const css = read('index.css');
    expect(css).toMatch(/\.seg-option\[aria-selected="true"\] \{\s*color: var\(--accent-text\);\s*font-weight: 600;\s*box-shadow: var\(--neu-inset\);/);
    expect(css).toMatch(/\.ui-segments input:checked \+ \.ui-segment \{/);
    for (const [f, label] of [['pages/Transactions.tsx', 'Transaction type'], ['pages/Reports.tsx', 'Report period'],
      ['pages/Debts.tsx', 'Payoff strategy'], ['components/recurring/BillCalendar.tsx', 'Calendar horizon'], ['pages/Insights.tsx', 'Insights views']]) {
      const s = read(f);
      expect(s, f).toMatch(new RegExp(`<SegRail[^]*?label="${label}"`));
      expect(s, f).not.toMatch(/role="tablist"/);
    }
  });

  it('A1-NAV-001 · sub-nav is an underline tab row: 13.5px phones, 14px desktop, no mono cap', () => {
    const s = read('components/layout/SubNav.tsx');
    expect(s).toMatch(/text-\[13\.5px\]/);
    expect(s).toMatch(/text-\[14px\]/);
    expect(s).toMatch(/boxShadow: 'inset 0 -2px 0 var\(--accent\)'/);
    expect(s).not.toMatch(/font-mono|{label} ▸/);
  });

  it('A1-MIST1-001 · Mist has darker text-only status shades; Nocturne text equals its fills', () => {
    const mist = mistBlock();
    expect(mist).toMatch(/--accent-text: #B5483A; --good-text: #1E7D5E; --warn-text: #8A6418; --info-text: #1E6F80; --crit-text: #B83E3E;/);
    expect(read('index.css')).toMatch(/--accent-text: #EC8474; --good-text: #4FD9AE; --warn-text: #F2C978; --info-text: #63D6EA; --crit-text: #F58A8C;/);
    for (const c of ['sage', 'honey', 'coral', 'denim', 'terra']) {
      expect(read('index.css')).toMatch(new RegExp(`\\[data-theme="warm"\\] \\.text-${c} +\\{ color: var\\(--`));
    }
    // Inline status TEXT colours read the text tokens, never the fill colour.
    for (const f of tsxFiles().filter(f => f !== 'pages/LandingView.tsx')) {
      expect(read(f), f).not.toMatch(/\bcolor: ?'(hsl\(var\(--(sage|honey|denim|terra)\)\)|var\(--(good|warn|info|crit)\))'/);
    }
  });

  it('A1-MIST2-001 · Mist wells are a flat fill with a hairline; Nocturne keeps the inset', () => {
    expect(mistBlock()).toMatch(/--well-bg: #EFF4F3; --well-shadow: none; --well-border: rgba\(20,33,31,\.08\);/);
    expect(read('index.css')).toMatch(/--well-bg: var\(--sunken\); --well-shadow: var\(--neu-inset\); --well-border: transparent;/);
  });

  it('A1-TS1-001 · the toast is a readable 14px bar with a 44px action, full width on phones, 380px on desktop', () => {
    const s = read('components/ui/ToastHost.tsx');
    expect(s).toMatch(/className=\{`fixed bottom-above-tabbar left-4 right-4 sm:left-auto sm:right-6 sm:w-\[380px\]/);
    // On a form page (no tab bar, Save/Add in the bottom footer) the toast moves under the header.
    expect(s).toMatch(/\$\{onForm \? ' toast-on-form' : ''\}/);
    expect(read('index.css')).toMatch(/\.toast-on-form \{ bottom: auto; top: calc\(env\(safe-area-inset-top, 0px\) \+ 68px\); \}/);
    expect(s).toMatch(/text-\[14px\]/);
    expect(s).toMatch(/min-h-\[44px\] px-2\.5 font-bold/);
    expect(s).not.toMatch(/font-mono|uppercase|border-l-\[3px\]/);
  });

  it('A1-ER1-001 · the crash screen is calm: what happened, nothing lost, two ways out, copy details', () => {
    const s = read('components/ui/ErrorBoundary.tsx');
    expect(s).toMatch(/This page didn't load/);
    expect(s).toMatch(/Nothing you entered was lost/);
    expect(s).toMatch(/href="\/dashboard">Go to Dashboard/);
    expect(s).toMatch(/Copy error details/);
    expect(s).not.toMatch(/>Something broke</);
  });

  it('A1-OF1-001 · the offline strip names the waiting changes and clears once synced', () => {
    expect(offlineMessage(false, 2, true)).toEqual({ lead: "You're offline.", rest: "2 changes are saved on this device and will sync when you're back." });
    expect(offlineMessage(false, 1, true)?.rest).toBe("1 change is saved on this device and will sync when you're back.");
    expect(offlineMessage(false, 0, false)?.lead).toBe("You're offline.");
    expect(offlineMessage(true, 3, true)).toEqual({ lead: 'Back online.', rest: 'Syncing 3 changes from this device…' });
    expect(offlineMessage(true, 3, false)).toBeNull();   // a routine flush never flashes the strip
    expect(offlineMessage(true, 0, true)).toBeNull();    // synced: it clears itself
    expect(read('components/layout/Layout.tsx')).toMatch(/<OfflineStrip \/>/);
  });

  it('A1-NT1-001 · "Needs you" holds unread action cards until handled, above Today and Earlier', () => {
    const card = { status: 'unread' as const, priority: 'P1' as const, actions: [{ id: 'approve', label: 'Approve', kind: 'primary' as const }] };
    expect(needsYou(card)).toBe(true);
    expect(needsYou({ ...card, status: 'read' })).toBe(false);
    expect(needsYou({ ...card, priority: 'P2' })).toBe(false);
    expect(needsYou({ ...card, actions: [] })).toBe(false);
    const s = read('components/layout/NotificationSheet.tsx');
    expect(s.indexOf('label="Needs you"')).toBeGreaterThan(0);
    expect(s.indexOf('label="Needs you"')).toBeLessThan(s.indexOf('label="Today"'));
    expect(s).toMatch(/!h-10/);   // NT2: 40px action buttons
    expect(s).not.toMatch(/mono-label/);
  });

  it('A1-X11-001 · method notes keep one line with details behind (i)', () => {
    for (const f of ['pages/Reports.tsx', 'pages/NetWorth.tsx', 'components/recurring/BillCalendar.tsx']) {
      expect(read(f), f).toMatch(/<InfoNote /);
    }
    expect(read('components/ui/InfoNote.tsx')).toMatch(/aria-expanded=\{open\}/);
  });
});
