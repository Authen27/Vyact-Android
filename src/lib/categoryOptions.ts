import { ALL_CATEGORIES, CATEGORIES_BY_TYPE, getCat, type CategoryMeta } from '../constants';
import type { TxnType } from '../types';

export function categoryOptions(type: TxnType | 'all', value = '', includeAll = false): CategoryMeta[] {
  if (type === 'transfer' || type === 'investment') return [];
  const categories: CategoryMeta[] = [...(type === 'all' ? ALL_CATEGORIES : CATEGORIES_BY_TYPE[type])]
    .sort((first, second) => first.label.localeCompare(second.label, 'en'));
  if (value && value !== 'all' && !categories.some(category => category.id === value)) {
    const legacy = getCat(value);
    if (categories.some(category => category.id === legacy.id)) {
      categories.unshift({ ...legacy, id: value, label: `${legacy.label} (saved category)` });
    }
  }
  return includeAll ? [{ id: 'all', label: 'All categories', icon: '', color: '' }, ...categories] : categories;
}

export function searchCategories(categories: readonly CategoryMeta[], query: string): CategoryMeta[] {
  const terms = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  return categories.filter(category => terms.every(term => category.label.toLocaleLowerCase('en').includes(term)));
}