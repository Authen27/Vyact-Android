import { expect, it } from 'vitest';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../constants';
import { categoryOptions, searchCategories } from '../categoryOptions';

it('uses the central icon and label metadata in one stable alphabetical order', () => {
  const options = categoryOptions('expense');
  expect(options).toHaveLength(EXPENSE_CATEGORIES.length);
  expect(options.map(option => option.label)).toEqual([...options.map(option => option.label)].sort((first, second) => first.localeCompare(second, 'en')));
  for (const category of EXPENSE_CATEGORIES) expect(options).toContainEqual(category);
});

it('keeps income and expense options separate and transfer/investment category-free', () => {
  expect(categoryOptions('income')).toHaveLength(INCOME_CATEGORIES.length);
  expect(categoryOptions('income').some(category => category.id === 'groceries')).toBe(false);
  expect(categoryOptions('expense').some(category => category.id === 'salary')).toBe(false);
  expect(categoryOptions('transfer', '', true)).toEqual([]);
  expect(categoryOptions('investment', '', true)).toEqual([]);
});

it('searches full labels without changing IDs and supports All categories in filters', () => {
  const options = categoryOptions('all', 'all', true);
  expect(options[0]).toMatchObject({ id: 'all', label: 'All categories' });
  expect(searchCategories(options, '  REPAIRS maintenance ')).toEqual([expect.objectContaining({ id: 'repairs_maintenance', label: 'Repairs & Maintenance' })]);
  expect(searchCategories(options, 'no matching category')).toEqual([]);
  expect(searchCategories(options, ' ')).toEqual(options);
});

it('displays a saved legacy alias without silently changing its value or offering it to new entries', () => {
  expect(categoryOptions('expense', 'transport')[0]).toMatchObject({ id: 'transport', label: 'Travel (saved category)' });
  expect(categoryOptions('expense').some(category => category.id === 'transport')).toBe(false);
  expect(categoryOptions('income', 'transport').some(category => category.id === 'transport')).toBe(false);
});