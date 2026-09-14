import {
  type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode,
  type ReactElement, forwardRef, useId, isValidElement, cloneElement,
} from 'react';

const baseClass =
  'field-control w-full bg-bg3 border border-line text-ink rounded-md px-3 py-2.5 ' +
  'font-ui text-[0.86rem] outline-none transition-all ' +
  'placeholder:text-ink-dim focus:border-coral focus:ring-2 focus:ring-coral/20';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...rest }, ref) => (
    <input ref={ref} className={`${baseClass} ${className}`} {...rest} />
  )
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', rows = 5, ...rest }, ref) => (
    <textarea ref={ref} rows={rows} className={`${baseClass} min-h-32 resize-y ${className}`} {...rest} />
  )
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', children, ...rest }, ref) => (
    <select ref={ref} className={`${baseClass} ff-select cursor-pointer ${className}`} {...rest}>
      {children}
    </select>
  )
);
Select.displayName = 'Select';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  // Associate the visible label with its control via htmlFor/id so the field
  // is reachable by accessible name (screen readers + Playwright getByLabel).
  // If the single child already carries an id we respect it; otherwise we
  // inject a generated one. Non-element children fall back to an unassociated
  // label (no regression vs. the previous markup).
  const generatedId = useId();
  const onlyChild = isValidElement(children)
    ? (children as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>)
    : null;
  const controlId = onlyChild ? (onlyChild.props.id ?? generatedId) : undefined;
  const descriptionId = `${generatedId}-description`;
  const control = onlyChild
    ? cloneElement(onlyChild, { id: controlId,
        'aria-describedby': [onlyChild.props['aria-describedby'], hint || error ? descriptionId : undefined].filter(Boolean).join(' ') || undefined,
        ...(error ? { 'aria-invalid': true } : {}),
      })
    : children;

  return (
    <div className="ui-field mb-3.5">
      <label
        htmlFor={controlId}
        className="block font-mono text-[0.6rem] tracking-[0.12em] uppercase text-ink-mid mb-1.5 font-medium"
      >
        {label}
      </label>
      {control}
      {(hint || error) && <p id={descriptionId} role={error ? 'alert' : undefined}
        className={`text-[12px] mt-2 leading-relaxed ${error ? 'text-terra' : 'text-ink-mid'}`}>{error || hint}</p>}
    </div>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3.5">{children}</div>;
}
