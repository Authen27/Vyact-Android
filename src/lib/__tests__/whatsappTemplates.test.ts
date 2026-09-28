// W1 (v10.41.0) — the WhatsApp template manifest against Meta's rules, and the
// exact wire shape a send produces. Contract-level: this proves a template here is
// well-formed and a send matches it; it does NOT prove Meta approved it (the status
// script reads that back from Meta).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  TEMPLATES, EVENT_ALIASES, templateForEvent, lintTemplate, variablesIn, metaSubmissionComponents, type TemplateDef,
} from '../../../../supabase/functions/_shared/whatsapp-templates';

import {
  MENU, LIST_LIMITS, receptionistList, menuReply, isReceptionistTrigger, welcomeButtonAction, welcomeParams,
} from '../../../../supabase/functions/_shared/whatsapp-receptionist';

const ROOT = resolve(__dirname, '../../../..');
let buildTemplateMessage: typeof import('../../../../supabase/functions/_shared/whatsapp')['buildTemplateMessage'];

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
  ({ buildTemplateMessage } = await import('../../../../supabase/functions/_shared/whatsapp'));
});

describe('the manifest follows Meta’s template rules', () => {
  it('CON-UNIT-WA-T-001 · every template passes lintTemplate', () => {
    for (const def of Object.values(TEMPLATES)) expect(lintTemplate(def), def.name).toEqual([]);
  });

  it('CON-UNIT-WA-T-002 · the lint catches each rule the design board broke', () => {
    const base: TemplateDef = { name: 'x_test', category: 'utility', language: 'en_US', status: 'in_review',
      body: 'Hello {{1}}, your bill is due soon.', params: [{ name: 'a', sample: 'Rohan' }] };
    const lint = (patch: Partial<TemplateDef>) => lintTemplate({ ...base, ...patch }).join(' | ');
    expect(lint({ body: '{{1}} starts in two days, and that is fine.' })).toContain('must not start');
    expect(lint({ body: 'Your bill is due on the day we agreed, {{1}}' })).toContain('must not end');
    expect(lint({ body: 'Hi {{1}}, you paid {{4}} and {{5}} more today, well done.',
      params: [{ name: 'a', sample: 'x' }, { name: 'b', sample: 'y' }, { name: 'c', sample: 'z' }] })).toContain('{{1}}…{{n}}');
    expect(lint({ body: 'That is ₹{{1}} {{2}} than your usual month, so far.',
      params: [{ name: 'a', sample: '1' }, { name: 'b', sample: 'more' }] })).toContain('side by side');
    expect(lint({ footer: "You're getting this because you opted into Vyact tips. Reply STOP TIPS to end them." })).toContain('footer is over');
    expect(lint({ params: [] })).toContain('1 variables but 0 params');
    expect(lint({ buttons: [{ type: 'quick_reply', text: 'Show me every suggestion now' }] })).toContain('over 25');
  });

  it('CON-UNIT-WA-T-003 · every header image exists in react/public/whatsapp and is a small JPEG', () => {
    for (const def of Object.values(TEMPLATES)) {
      if (!def.headerImage) continue;
      const file = resolve(ROOT, 'react/public/whatsapp', def.headerImage);
      expect(existsSync(file), def.headerImage).toBe(true);
      expect(readFileSync(file).length, def.headerImage).toBeLessThan(200_000);
    }
  });

  it('CON-UNIT-WA-T-004 · every legacy event resolves, and templates resolve by their own name', () => {
    for (const [event, name] of Object.entries(EVENT_ALIASES)) expect(templateForEvent(event)?.name, event).toBe(name);
    expect(templateForEvent('payday_headroom')?.name).toBe('payday_headroom');
    expect(templateForEvent('no_such_thing')).toBeNull();
  });

  it('CON-UNIT-WA-T-005 · every template is recorded in docs/WHATSAPP_TEMPLATES.md', () => {
    const doc = readFileSync(resolve(ROOT, 'docs/WHATSAPP_TEMPLATES.md'), 'utf8');
    for (const name of Object.keys(TEMPLATES)) expect(doc, name).toContain('`' + name + '`');
  });

  it('CON-UNIT-WA-T-006 · a template Meta flagged as marketing is treated as marketing', () => {
    expect(TEMPLATES.weekly_summary.category).toBe('marketing');
    for (const n of ['runway_shift_alert', 'budget_setup_reminder', 'balance_stale_nudge', 'reengagement_nudge']) {
      expect(TEMPLATES[n].category, n).toBe('marketing');
    }
  });
});

describe('the receptionist menu stays inside Meta’s list limits', () => {
  it('CON-UNIT-WA-R-004 · rows, titles, descriptions, ids and the button fit, and every row has a reply', () => {
    const rows = MENU.flatMap(s => s.rows);
    expect(rows.length).toBeLessThanOrEqual(LIST_LIMITS.rows);
    for (const s of MENU) expect(s.title.length, s.title).toBeLessThanOrEqual(LIST_LIMITS.sectionTitle);
    for (const r of rows) {
      expect(r.title.length, r.title).toBeLessThanOrEqual(LIST_LIMITS.rowTitle);
      expect(r.description.length, r.id).toBeLessThanOrEqual(LIST_LIMITS.rowDescription);
      expect(menuReply(r.id, 'https://vyact.app'), r.id).toBeTruthy();
    }
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    const list = receptionistList('good morning', 'Rohan');
    expect(list.button.length).toBeLessThanOrEqual(LIST_LIMITS.button);
    expect((list.footer ?? '').length).toBeLessThanOrEqual(LIST_LIMITS.footer);
    expect(list.body).toMatch(/^Morning, Rohan\./);
    expect(receptionistList('menu').body).toBe("Here's everything I can do in this chat.");
    expect(menuReply('menu:unknown', 'https://vyact.app')).toBeNull();
  });

  it('CON-UNIT-WA-R-005 · only a whole-message greeting or MENU/HELP opens it', () => {
    for (const t of ['hi', 'Hello!', 'hey vyact', 'Good morning', 'MENU', 'help', 'hiii']) expect(isReceptionistTrigger(t), t).toBe(true);
    for (const t of ['hi 450 lunch', '450 lunch', 'help me log 200 fuel', 'history']) expect(isReceptionistTrigger(t), t).toBe(false);
  });

  it('CON-UNIT-WA-R-008 · every welcome button, by payload index and by label, maps to the menu or a real row', () => {
    const def = TEMPLATES.whatsapp_welcome;
    expect(def.category).toBe('utility');
    expect(def.headerImage).toBe('12-welcome.jpg');
    const quick = (def.buttons ?? []).filter(b => b.type === 'quick_reply');
    expect(quick.map(b => b.text)).toEqual(['Menu', 'Log a spend', 'What can I send?']);
    (def.buttons ?? []).forEach((b, i) => {
      const byPayload = welcomeButtonAction(`whatsapp_welcome:${i}:ctx`);
      expect(byPayload, b.text).toBe(welcomeButtonAction(b.text));   // the two paths agree
      expect(byPayload === 'menu' || !!menuReply(String(byPayload), 'https://vyact.app'), b.text).toBe(true);
    });
    expect(welcomeButtonAction('whatsapp_welcome:9:ctx')).toBeNull();
    expect(welcomeButtonAction('partner_split_prompt:0:ctx', 'Menu')).toBeNull();   // another template's payload wins
    expect(welcomeButtonAction(undefined, 'Mark as paid')).toBeNull();
  });

  it('CON-UNIT-WA-R-009 · the welcome values never go out empty', () => {
    expect(welcomeParams('Rohan Mehta', 'Mehta Household')).toEqual(['Rohan', 'Mehta Household']);
    expect(welcomeParams('  ', null)).toEqual(['friend', 'your household']);
    const msg = buildTemplateMessage(TEMPLATES.whatsapp_welcome, welcomeParams(null, 'Rao Household'), { appUrl: 'https://vyact.app', context: 'link:h:111' });
    expect(msg.components.filter(c => c.type === 'button').map(c => (c as { parameters: { payload: string }[] }).parameters[0].payload))
      .toEqual(['whatsapp_welcome:0:link:h:111', 'whatsapp_welcome:1:link:h:111', 'whatsapp_welcome:2:link:h:111']);
  });
});

describe('the wire shape of a send', () => {
  const opts = { appUrl: 'https://vyact.app', context: 'sched-9:2026-09-25' };

  it('CON-UNIT-WA-T-007 · an image template carries its header image link on every send', () => {
    const msg = buildTemplateMessage(TEMPLATES.payday_headroom, ['Rohan', '92,000', '56,900', 'five', '35,100'], opts);
    expect(msg.name).toBe('payday_headroom');
    expect(msg.language).toEqual({ code: 'en_US' });
    expect(msg.components[0]).toEqual({ type: 'header', parameters: [{ type: 'image', image: { link: 'https://vyact.app/whatsapp/02-payday.jpg' } }] });
    expect(msg.components[1]).toEqual({ type: 'body', parameters: ['Rohan', '92,000', '56,900', 'five', '35,100'].map(text => ({ type: 'text', text })) });
  });

  it('CON-UNIT-WA-T-008 · quick replies carry template:index:context payloads; URL buttons take none', () => {
    const msg = buildTemplateMessage(TEMPLATES.large_transaction_alert, ['18,000', 'HDFC card'], opts);
    const buttons = msg.components.filter(c => c.type === 'button');
    expect(buttons).toEqual([
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'large_transaction_alert:1:sched-9:2026-09-25' }] },
      { type: 'button', sub_type: 'quick_reply', index: '2', parameters: [{ type: 'payload', payload: 'large_transaction_alert:2:sched-9:2026-09-25' }] },
    ]);
    expect(msg.components.some(c => c.type === 'header')).toBe(false);   // a text template has no header
  });

  it('CON-UNIT-WA-T-009 · a wrong value count throws, naming what was expected', () => {
    expect(() => buildTemplateMessage(TEMPLATES.budget_threshold_alert, ['Dining', '78', '18'], opts))
      .toThrow(/needs 4 values \(category, percentUsed, daysLeft, remaining\), got 3/);
  });

  it('CON-UNIT-WA-T-010 · values are cleaned of the newlines Meta rejects', () => {
    const msg = buildTemplateMessage(TEMPLATES.split_settled, ['Priya', '₹600', 'Dinner\nat Olive'], opts);
    const body = msg.components.find(c => c.type === 'body') as { parameters: { text: string }[] };
    expect(body.parameters[2].text).toBe('Dinner at Olive');
  });

  it('CON-UNIT-WA-T-012 · the Meta submission carries header handle, body samples, footer and buttons', () => {
    const c = metaSubmissionComponents(TEMPLATES.balance_stale_nudge, 'h:abc');
    expect(c[0]).toEqual({ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h:abc'] } });
    expect(c[1]).toEqual({ type: 'BODY', text: TEMPLATES.balance_stale_nudge.body, example: { body_text: [['Rohan', 'four']] } });
    expect(c[2]).toEqual({ type: 'FOOTER', text: 'At most once a week. Reply STOP BALANCES to end these.' });
    expect(c[3]).toEqual({ type: 'BUTTONS', buttons: [
      { type: 'URL', text: 'Update balances', url: 'https://vyact.app/accounts' },
      { type: 'QUICK_REPLY', text: 'Not now' },
    ] });
    // A link whose approved URL was never recorded cannot be resubmitted by guesswork.
    // (Every live link has its URL recorded since 26 Sep, so the guard is tested on a copy without one.)
    const unrecorded = { ...TEMPLATES.weekly_summary, buttons: [{ type: 'url' as const, text: 'See details' }] };
    expect(() => metaSubmissionComponents(unrecorded, 'h:abc')).toThrow(/no recorded URL/);
    expect(() => metaSubmissionComponents(TEMPLATES.payday_headroom)).toThrow(/upload handle/);
  });

  it('CON-UNIT-WA-T-011 · every template builds from its own samples', () => {
    for (const def of Object.values(TEMPLATES)) {
      const msg = buildTemplateMessage(def, def.params.map(p => p.sample), opts);
      expect(variablesIn(def.body).length, def.name).toBe(def.params.length);
      expect(msg.name, def.name).toBe(def.name);
    }
  });
});
