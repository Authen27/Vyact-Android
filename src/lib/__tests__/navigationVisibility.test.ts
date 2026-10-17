import { expect, it } from 'vitest';
import { ACCOUNT_ROUTES, SECTIONS, STANDALONE_ROUTES, sectionForPath, visiblePages } from '../../components/layout/navModel';
import { TEMPLATES, type TemplateKey } from '../templates';

it('Accounts stays visible for every household template, including an unset template', () => {
  for (const template of [undefined, ...Object.keys(TEMPLATES)] as Array<TemplateKey | undefined>) {
    expect(visiblePages(template).has('accounts'), String(template)).toBe(true);
  }
});

it('Accounts has one canonical Plan route shared by navigation and the command palette', () => {
  const routes = [...SECTIONS.flatMap(section => section.routes), ...ACCOUNT_ROUTES];
  expect(routes.filter(route => route.page === 'accounts')).toEqual([
    expect.objectContaining({ to: '/accounts', label: 'Accounts' }),
  ]);
  expect(SECTIONS.find(section => section.id === 'plan')?.routes.some(route => route.page === 'accounts')).toBe(true);
  expect(sectionForPath('/accounts')).toBe('plan');
});

it('Pip (/chat) is a page of its own, not part of the account menu (v10.53.0)', () => {
  expect(sectionForPath('/chat')).toBe('standalone');
  expect(STANDALONE_ROUTES).toEqual([expect.objectContaining({ to: '/chat', label: 'Pip' })]);
  expect(sectionForPath('/settings')).toBe('account');
  expect(sectionForPath('/networth')).toBe('analyze');
});
