import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELP_TOPICS, searchHelpTopics } from '../helpContent';

describe('Help & Guide content contract', () => {
  it('has stable unique topics, complete answers and the four task groups', () => {
    expect(new Set(HELP_TOPICS.map(topic => topic.id)).size).toBe(HELP_TOPICS.length);
    expect(new Set(HELP_TOPICS.map(topic => topic.group))).toEqual(new Set(['Start here', 'Everyday money', 'Planning', 'Access and support']));
    for (const topic of HELP_TOPICS) {
      expect(topic.question.endsWith('?')).toBe(true);
      expect(topic.answer.length).toBeGreaterThan(30);
      expect(topic.link.label.length).toBeGreaterThan(0);
    }
  });

  it('searches full answers, steps and caveats regardless of case or extra whitespace', () => {
    expect(searchHelpTopics('  CASH   counted  ').map(topic => topic.id)).toContain('cash-reconcile');
    expect(searchHelpTopics('offset').map(topic => topic.id)).toContain('cash-reconcile');
    expect(searchHelpTopics('read-only').map(topic => topic.id)).toContain('household');
    expect(searchHelpTopics('  ')).toBe(HELP_TOPICS);
    expect(searchHelpTopics('no-such-topic-xyz')).toEqual([]);
  });

  it('does not advertise retired modules or the old split and investment-account flows', () => {
    const copy = JSON.stringify(HELP_TOPICS);
    expect(copy).not.toMatch(/Add goal|Goal Progress|Saved Views|5 components|quarterly|half-yearly|tick.*Split this bill|create an investment account/i);
    expect(HELP_TOPICS.find(topic => topic.id === 'split')?.answer).toContain('Start on Splits');
    expect(HELP_TOPICS.find(topic => topic.id === 'investment')?.answer).toContain('asset in Net Worth');
    expect(HELP_TOPICS.find(topic => topic.id === 'exports')?.note).toContain('not a complete, verified restore');
  });

  it('links only to current destinations and includes availability caveats', () => {
    const routes = new Set(['/accounts', '/transactions', '/splits', '/networth', '/chat', '/budgets', '/recurring', '/debts', '/reports', '/households', '/settings']);
    for (const topic of HELP_TOPICS) expect(routes.has(topic.link.to)).toBe(true);
    expect(HELP_TOPICS.find(topic => topic.id === 'budget')?.note).toContain('online cloud session');
    expect(HELP_TOPICS.find(topic => topic.id === 'ask-unavailable')?.answer).toContain('unavailable');
    expect(HELP_TOPICS.find(topic => topic.id === 'whatsapp')?.note).toContain('provider approval');
  });

  it('ships six real current PNG screenshots with matching intrinsic dimensions', () => {
    const illustrated = HELP_TOPICS.filter(topic => topic.image);
    expect(illustrated).toHaveLength(6);
    for (const topic of illustrated) {
      const image = topic.image!;
      expect(image.src).toMatch(/^\/help\/current\/[a-z-]+\.png$/);
      const buffer = readFileSync(new URL(`../../../public${image.src}`, import.meta.url));
      expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(buffer.readUInt32BE(16)).toBe(image.width);
      expect(buffer.readUInt32BE(20)).toBe(image.height);
      expect(image.width).toBeGreaterThan(300);
      expect(image.height).toBeGreaterThan(300);
    }
  });
});