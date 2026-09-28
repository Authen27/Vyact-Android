import { useId, type ReactNode } from 'react';

interface Props<Value extends string> {
  label: string;
  value: Value;
  options: { value: Value; label: ReactNode; disabled?: boolean; testId?: string }[];
  onChange: (value: Value) => void;
}

export default function SegmentedControl<Value extends string>({ label, value, options, onChange }: Props<Value>) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="ui-label mb-related">{label}</legend>
      <div className="ui-segments">
        {options.map(option => (
          <label key={option.value} className="relative flex-1 min-w-0">
            <input type="radio" name={name} value={option.value} checked={value === option.value}
              disabled={option.disabled} onChange={() => onChange(option.value)}
              data-testid={option.testId} className="peer" />
            <span className="ui-segment peer-checked:bg-bg2 peer-checked:text-coral peer-checked:shadow-sm peer-disabled:opacity-40 peer-disabled:cursor-not-allowed">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}