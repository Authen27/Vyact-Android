import { useId } from 'react';
import { Field, Select } from './Input';
import { categoryOptions } from '../../lib/categoryOptions';
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
}

export default function CategoryPicker({ value, onChange, type, label = 'Category', id, disabled = false,
  includeAll = false, error, hint, testId }: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const categories = categoryOptions(type, value, includeAll);
  if (type === 'transfer' || type === 'investment') return null;

  return (
    <Field label={label} error={error} hint={hint}>
      <Select id={inputId} data-testid={testId} value={value} disabled={disabled}
        onChange={event => onChange(event.target.value)}>
        <option value="" disabled>Choose category</option>
        {value && !categories.some(category => category.id === value) &&
          <option value={value} disabled>{value} (saved category)</option>}
        {categories.map(category => <option key={category.id} value={category.id}>
          {category.icon ? `${category.icon} ` : ''}{category.label}
        </option>)}
      </Select>
    </Field>
  );
}