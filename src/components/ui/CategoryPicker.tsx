import { useId } from 'react';
import { Field, Select } from './Input';
import { categoryOptions } from '../../lib/categoryOptions';
import type { CategoryMeta } from '../../constants';
import type { TxnType } from '../../types';

interface Props {
  value: string;
  onChange: (value: string) => void;
  type: TxnType | 'all';
  label?: string;
  id?: string;
  disabled?: boolean;
  includeAll?: boolean;
  error?: string;
  hint?: string;
  testId?: string;
  /** Category ids this form does not offer (the current value is always kept visible). */
  exclude?: readonly string[];
  /** Aurora 4.0 CAT3 — the household's most used ids, listed first in a "Recently used" group
   *  (native optgroups, no custom widget). Each id appears once: the rest go under "All categories". */
  recent?: readonly string[];
}

const optionLabel = (category: CategoryMeta) => `${category.icon ? `${category.icon} ` : ''}${category.label}`;

export default function CategoryPicker({ value, onChange, type, label = 'Category', id, disabled = false,
  includeAll = false, error, hint, testId, exclude, recent }: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const categories = categoryOptions(type, value, includeAll, exclude);
  if (type === 'transfer' || type === 'investment') return null;
  const first = (recent ?? []).map(r => categories.find(c => c.id === r)).filter((c): c is CategoryMeta => !!c);
  const rest = first.length ? categories.filter(c => !first.includes(c)) : categories;

  return (
    <Field label={label} error={error} hint={hint}>
      <Select id={inputId} data-testid={testId} value={value} disabled={disabled}
        onChange={event => onChange(event.target.value)}>
        <option value="" disabled>Choose category</option>
        {value && !categories.some(category => category.id === value) &&
          <option value={value} disabled>{value} (saved category)</option>}
        {first.length > 0 ? (
          <>
            <optgroup label="Recently used">
              {first.map(category => <option key={category.id} value={category.id}>{optionLabel(category)}</option>)}
            </optgroup>
            <optgroup label="All categories">
              {rest.map(category => <option key={category.id} value={category.id}>{optionLabel(category)}</option>)}
            </optgroup>
          </>
        ) : categories.map(category => <option key={category.id} value={category.id}>{optionLabel(category)}</option>)}
      </Select>
    </Field>
  );
}
