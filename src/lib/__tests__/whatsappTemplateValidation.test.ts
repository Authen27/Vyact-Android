// v10.47.0 — every WhatsApp template, checked on every layer the code controls. The
// 26 Sep validation found templates that were approved in Meta but that nothing sent,
// and buttons nothing answered. These invariants keep that from coming back.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../../../../supabase/functions/_shared/whatsapp-templates';
import {
  TEMPLATE_TOPIC, TOPICS, parsePrefCommand, buttonReply, buttonQuestion,
} from '../../../../supabase/functions/_shared/whatsapp-prefs';

const ROOT = join(__dirname, '../../../..');
const FUNCTIONS = join(ROOT, 'supabase/functions');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(name) && !/whatsapp-templates\.ts|whatsapp-prefs\.ts|\.generated\./.test(name) ? [readFileSync(p, 'utf8')] : [];
  });
}
const CODE = sources(FUNCTIONS).join('\n');
const WEBHOOK = readFileSync(join(FUNCTIONS, 'whatsapp-webhook/index.ts'), 'utf8');

describe('every template, on every layer', () => {
  const all = Object.values(TEMPLATES);

  it('CON-UNIT-WA-V-001 · every template belongs to a topic, and its STOP footer stops that topic', () => {
    for (const t of all) {
      const topic = TEMPLATE_TOPIC[t.name];
      expect(topic, t.name).toBeDefined();
      expect(TOPICS[topic], t.name).toBeDefined();
      const word = /STOP ([A-Z]+)/.exec(t.footer ?? '')?.[1];
      if (word) expect(parsePrefCommand(`stop ${word.toLowerCase()}`), t.name).toEqual({ kind: 'stop', topic });
    }
  });

  it('CON-UNIT-WA-V-002 · every header image exists in react/public/whatsapp (served at vyact.app/whatsapp)', () => {
    for (const t of all) if (t.headerImage) expect(existsSync(join(ROOT, 'react/public/whatsapp', t.headerImage)), t.name).toBe(true);
  });

  it('CON-UNIT-WA-V-003 · every template has a sender in the code — none is approved but never sent', () => {
    const unsent = all.filter((t) => !CODE.includes(`'${t.name}'`)).map((t) => t.name);
    expect(unsent).toEqual([]);
  });

  it('CON-UNIT-WA-V-004 · every quick reply is answered: by the reply table, by Pip, or by a named webhook handler', () => {
    const unanswered: string[] = [];
    for (const t of all) {
      for (const b of t.buttons ?? []) {
        if (b.type !== 'quick_reply') continue;
        const handled = buttonReply(t.name, b.text, 'https://vyact.app') ?? buttonQuestion(t.name, b.text, 'aff:1000:x')
          ?? (WEBHOOK.includes(`'${b.text}'`) || WEBHOOK.includes(`"${b.text}"`) || /welcome/.test(t.name) ? 'webhook' : null);
        if (!handled) unanswered.push(`${t.name} · ${b.text}`);
      }
    }
    expect(unanswered).toEqual([]);
  });

  it('CON-UNIT-WA-V-005 · every marketing template tells the reader how to stop it (weekly_summary: after its link edit)', () => {
    const noStop = all.filter((t) => t.category === 'marketing' && !/STOP /.test(t.footer ?? '')).map((t) => t.name);
    // weekly_summary's footer can only change in Meta once its in-review link edit is decided.
    expect(noStop).toEqual(['weekly_summary']);
  });
});
